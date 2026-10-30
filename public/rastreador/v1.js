/*
 * Rastreador do CRM: o script que um cardápio ou página de terceiro cola para contar ao CRM o que o cliente fez.
 *
 * Escrito à mão para este produto, sem dependência e sem trecho de SDK de terceiro. API MANUAL: quem integra chama
 * `track` onde quer; NÃO há observação automática de atributos HTML e NÃO se lê o `dataLayer`.
 *
 *   rastreador('init',  { key: 'pk_...' [, debug: true] [, storage: false] [, endpoint: 'https://seu-crm'] });
 *   rastreador('track', 'page_view', { screen_name: 'home' });
 *   rastreador('optOut');   // o visitante pediu para não ser rastreado: apaga o que foi guardado e para
 *   rastreador('optIn');    // desfaz o optOut
 *
 * O que ele garante:
 *  · cada evento ganha um `event_id` (UUID) ao nascer e o mantém até a confirmação: reenviar nunca duplica;
 *  · envia em lote (até 20 por vez, a cada 3 s) e, ao sair da página, o que sobrou (sendBeacon);
 *  · falha de rede, 429 e 5xx são reenviados com espera crescente; qualquer outro 4xx é definitivo e NÃO é reenviado;
 *  · sem `idtrack` válido (UUID na URL, `?idtrack=`), NADA é enviado — não há identidade a registrar;
 *  · nunca envia telefone, e-mail nem nome: chaves assim são removidas dos dados antes de enfileirar;
 *  · o que é guardado no navegador é só o `idtrack` (sessionStorage) e, se o visitante optou por sair, um marcador
 *    em localStorage. `storage: false` não guarda nada;
 *  · tudo roda dentro de try/catch: uma falha aqui NUNCA quebra a página que o carrega.
 *
 * O cancelamento de pedido NÃO passa por aqui: o navegador não tem autoridade para isso (ver a documentação).
 */
(function (w) {
  "use strict";

  var CHAVE = /^pk_[a-f0-9]{36}$/;
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  var NOME_DO_EVENTO = /^[a-z][a-z0-9_]{0,63}$/;
  var LOTE = 20;
  var INTERVALO_MS = 3000;
  var ESPERA_MAXIMA_MS = 60000;
  var FILA_MAXIMA = 200;
  var TENTATIVAS_MAXIMAS = 5;
  var PROFUNDIDADE_MAXIMA = 6;
  var NA_SESSAO = "rastreador_idtrack";
  var NO_NAVEGADOR = "rastreador_optout";
  // Chaves (em minúsculas, exatas) que identificam a pessoa. `item_name` não está aqui: é nome de produto.
  var PESSOAIS = {
    phone: 1, telefone: 1, celular: 1, whatsapp: 1, email: 1, "e-mail": 1, mail: 1, name: 1, nome: 1,
    full_name: 1, first_name: 1, last_name: 1, customer_name: 1, nome_completo: 1, cpf: 1, cnpj: 1,
  };

  var cfg = null;
  var fila = [];
  var idtrack = null;
  var optouSair = false;
  var temporizador = null;
  var enviando = false;
  var falhasSeguidas = 0;
  var avisadas = {};
  var anterior = w.rastreador;

  function aviso() {
    if (!cfg || !cfg.debug || !w.console || !w.console.warn) return;
    try {
      w.console.warn.apply(w.console, ["[rastreador]"].concat([].slice.call(arguments)));
    } catch { /* o aviso nunca atrapalha */ }
  }

  function origemDoScript() {
    try {
      var s = w.document && w.document.currentScript;
      var m = s && s.src ? /^(https?:\/\/[^/]+)/i.exec(s.src) : null;
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
  var origemPadrao = origemDoScript();

  function novoUuid() {
    var c = w.crypto;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
    var b = new Uint8Array(16);
    if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [];
    for (var j = 0; j < 16; j++) h.push((b[j] + 0x100).toString(16).slice(1));
    return h.slice(0, 4).join("") + "-" + h.slice(4, 6).join("") + "-" + h.slice(6, 8).join("") + "-" +
      h.slice(8, 10).join("") + "-" + h.slice(10).join("");
  }

  function guardado(tipo) {
    if (!cfg || !cfg.storage) return null;
    try {
      return tipo === "sessao" ? w.sessionStorage : w.localStorage;
    } catch {
      return null;
    }
  }

  // Remove telefone, e-mail e nome dos dados — pela CHAVE, em qualquer profundidade. Valor que parece e-mail sai também.
  function limpar(valor, fundo) {
    if (valor === null || typeof valor !== "object") {
      if (typeof valor === "string" && /\S+@\S+\.\S+/.test(valor)) return undefined;
      return valor;
    }
    if (fundo >= PROFUNDIDADE_MAXIMA) return undefined;
    var saida;
    var v;
    if (Object.prototype.toString.call(valor) === "[object Array]") {
      saida = [];
      for (var i = 0; i < valor.length; i++) {
        v = limpar(valor[i], fundo + 1);
        if (v !== undefined) saida.push(v);
      }
      return saida;
    }
    saida = {};
    for (var k in valor) {
      if (!Object.prototype.hasOwnProperty.call(valor, k)) continue;
      if (PESSOAIS[String(k).toLowerCase()]) continue;
      v = limpar(valor[k], fundo + 1);
      if (v !== undefined) saida[k] = v;
    }
    return saida;
  }

  function lerIdtrackDaUrl() {
    try {
      var m = /[?&]idtrack=([^&#]*)/.exec((w.location && w.location.search) || "");
      if (!m) return null;
      var v = decodeURIComponent(m[1]);
      return UUID.test(v) ? v.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  function descobrirIdtrack() {
    var daUrl = lerIdtrackDaUrl();
    var sessao = guardado("sessao");
    if (daUrl) {
      if (sessao) {
        try { sessao.setItem(NA_SESSAO, daUrl); } catch { /* sem espaço: segue em memória */ }
      }
      return daUrl;
    }
    if (sessao) {
      try {
        var salvo = sessao.getItem(NA_SESSAO);
        if (salvo && UUID.test(salvo)) return salvo.toLowerCase();
      } catch { /* ignora */ }
    }
    return null;
  }

  function init(opcoes) {
    if (!opcoes || typeof opcoes.key !== "string" || !CHAVE.test(opcoes.key)) {
      cfg = { debug: !!(opcoes && opcoes.debug) };
      aviso("init: a chave precisa ser a chave pública do funil (começa com pk_).");
      cfg = null;
      return;
    }
    var endpoint = (opcoes.endpoint || origemPadrao || "").replace(/\/+$/, "");
    cfg = { key: opcoes.key, debug: !!opcoes.debug, storage: opcoes.storage !== false, endpoint: endpoint };
    if (!endpoint) aviso("init: não consegui descobrir o endereço do CRM; informe `endpoint`.");
    var local = guardado("navegador");
    try {
      optouSair = !!(local && local.getItem(NO_NAVEGADOR) === "1");
    } catch {
      optouSair = false;
    }
    idtrack = optouSair ? null : descobrirIdtrack();
    if (!idtrack && !optouSair) aviso("sem idtrack válido na URL: nenhum evento será enviado.");
  }

  function track(evento, dados) {
    if (!cfg || !cfg.endpoint) return;
    if (optouSair || !idtrack) return;
    if (typeof evento !== "string" || !NOME_DO_EVENTO.test(evento)) {
      aviso("track: nome de evento inválido (minúsculas, números e _, começando por letra):", evento);
      return;
    }
    var limpo = dados === undefined || dados === null ? undefined : limpar(dados, 0);
    var item = { event: evento, event_id: novoUuid(), at: new Date().toISOString(), tentativas: 0 };
    if (limpo !== undefined && typeof limpo === "object" && limpo !== null) item.data = limpo;
    fila.push(item);
    if (fila.length > FILA_MAXIMA) fila.shift();
    if (fila.length >= LOTE) enviar();
    else agendar(INTERVALO_MS);
  }

  function agendar(ms) {
    if (temporizador !== null) return;
    temporizador = w.setTimeout(function () {
      temporizador = null;
      enviar();
    }, ms);
  }

  function paraOCorpo(lote) {
    var corpo = { idtrack: idtrack, events: [] };
    for (var i = 0; i < lote.length; i++) {
      var e = { event: lote[i].event, event_id: lote[i].event_id, at: lote[i].at };
      if (lote[i].data) e.data = lote[i].data;
      corpo.events.push(e);
    }
    if (cfg.debug) corpo.debug = true;
    return corpo;
  }

  function url() {
    return cfg.endpoint + "/api/v1/coleta/" + cfg.key;
  }

  function tirarDaFila(lote) {
    var ids = {};
    for (var i = 0; i < lote.length; i++) ids[lote[i].event_id] = 1;
    fila = fila.filter(function (e) { return !ids[e.event_id]; });
  }

  function conferirNoDebug(lote, resposta) {
    if (!cfg.debug || !resposta || !resposta.data) return;
    var cadastradas = resposta.data.chaves_cadastradas;
    if (Object.prototype.toString.call(cadastradas) !== "[object Array]") return;
    for (var i = 0; i < lote.length; i++) {
      var nome = lote[i].event;
      if (cadastradas.indexOf(nome) === -1 && !avisadas[nome]) {
        avisadas[nome] = 1;
        aviso("o evento \"" + nome + "\" não está cadastrado neste funil e será recusado. Cadastrados: " +
          (cadastradas.length ? cadastradas.join(", ") : "(nenhum)") + ".");
      }
    }
  }

  function falhouEmTentar(lote, esperaDoServidorMs) {
    falhasSeguidas++;
    var sobreviventes = [];
    for (var i = 0; i < lote.length; i++) {
      lote[i].tentativas++;
      if (lote[i].tentativas > TENTATIVAS_MAXIMAS) aviso("desisti do evento", lote[i].event, "depois de várias tentativas.");
      else sobreviventes.push(lote[i]);
    }
    var perdidos = {};
    for (var j = 0; j < lote.length; j++) perdidos[lote[j].event_id] = 1;
    var vivos = {};
    for (var s = 0; s < sobreviventes.length; s++) vivos[sobreviventes[s].event_id] = 1;
    fila = fila.filter(function (e) { return !perdidos[e.event_id] || vivos[e.event_id]; });
    var espera = esperaDoServidorMs || Math.min(INTERVALO_MS * Math.pow(2, falhasSeguidas), ESPERA_MAXIMA_MS);
    return Math.min(espera, ESPERA_MAXIMA_MS);
  }

  function enviar() {
    if (!cfg || enviando || fila.length === 0 || optouSair || !idtrack) return;
    var lote = fila.slice(0, LOTE);
    enviando = true;
    var depois = INTERVALO_MS;
    var terminou = function () {
      enviando = false;
      if (fila.length > 0) agendar(depois);
    };
    try {
      w.fetch(url(), {
        method: "POST",
        // text/plain mantém a requisição "simples": o navegador não faz o preflight de CORS antes de cada lote.
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: JSON.stringify(paraOCorpo(lote)),
        mode: "cors",
        credentials: "omit",
        keepalive: true,
      }).then(function (res) {
        if (res.status >= 200 && res.status < 300) {
          falhasSeguidas = 0;
          tirarDaFila(lote);
          depois = INTERVALO_MS;
          if (!cfg.debug) return;
          return res.json().then(function (j) { conferirNoDebug(lote, j); }, function () { /* sem corpo */ });
        }
        if (res.status === 429 || res.status >= 500) {
          var ra = parseInt(res.headers && res.headers.get && res.headers.get("Retry-After"), 10);
          depois = falhouEmTentar(lote, ra > 0 ? ra * 1000 : 0);
          return;
        }
        // Qualquer outro 4xx (chave revogada, origem não permitida, corpo inválido) é DEFINITIVO: reenviar repete a recusa.
        aviso("o CRM recusou o lote (HTTP " + res.status + "); não vou reenviar.");
        tirarDaFila(lote);
      }).then(terminou, function () {
        depois = falhouEmTentar(lote, 0);
        terminou();
      });
    } catch {
      depois = falhouEmTentar(lote, 0);
      terminou();
    }
  }

  // Ao sair da página: o que sobrou vai por sendBeacon (sobrevive ao fechamento); sem ele, fetch com keepalive.
  function aoSair() {
    try {
      if (!cfg || optouSair || !idtrack || fila.length === 0) return;
      while (fila.length > 0) {
        var lote = fila.slice(0, LOTE);
        var corpo = JSON.stringify(paraOCorpo(lote));
        var foi = false;
        if (w.navigator && typeof w.navigator.sendBeacon === "function" && typeof w.Blob === "function") {
          foi = w.navigator.sendBeacon(url(), new w.Blob([corpo], { type: "text/plain;charset=UTF-8" }));
        }
        if (!foi) {
          w.fetch(url(), {
            method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: corpo,
            mode: "cors", credentials: "omit", keepalive: true,
          }).catch(function () { /* a página está saindo */ });
        }
        // Na saída não há como confirmar: o `event_id` estável faz um reenvio futuro ser repetição, não duplicata.
        tirarDaFila(lote);
      }
    } catch { /* nunca quebra a saída da página */ }
  }

  function optOut() {
    optouSair = true;
    fila = [];
    idtrack = null;
    if (temporizador !== null) {
      w.clearTimeout(temporizador);
      temporizador = null;
    }
    try {
      var sessao = guardado("sessao");
      if (sessao) sessao.removeItem(NA_SESSAO);
      var local = guardado("navegador");
      if (local) local.setItem(NO_NAVEGADOR, "1");
    } catch { /* ignora */ }
  }

  function optIn() {
    optouSair = false;
    try {
      var local = guardado("navegador");
      if (local) local.removeItem(NO_NAVEGADOR);
    } catch { /* ignora */ }
    if (cfg) idtrack = descobrirIdtrack();
  }

  function comando(nome) {
    try {
      var args = [].slice.call(arguments, 1);
      if (nome === "init") init(args[0]);
      else if (nome === "track") track(args[0], args[1]);
      else if (nome === "optOut") optOut();
      else if (nome === "optIn") optIn();
      else if (nome === "flush") enviar();
      else aviso("comando desconhecido:", nome);
    } catch { /* uma falha do rastreador nunca quebra a página */ }
  }

  var api = function () {
    comando.apply(null, arguments);
  };
  api.init = function (o) { comando("init", o); };
  api.track = function (e, d) { comando("track", e, d); };
  api.optOut = function () { comando("optOut"); };
  api.optIn = function () { comando("optIn"); };
  api.flush = function () { comando("flush"); };

  try {
    if (w.addEventListener) w.addEventListener("pagehide", aoSair);
    if (w.document && w.document.addEventListener) {
      w.document.addEventListener("visibilitychange", function () {
        if (w.document.visibilityState === "hidden") aoSair();
      });
    }
  } catch { /* ignora */ }

  w.rastreador = api;
  // As chamadas feitas ANTES de este arquivo carregar (o pequeno trecho de instalação as enfileira em `q`).
  try {
    var pendentes = anterior && anterior.q ? anterior.q : [];
    for (var p = 0; p < pendentes.length; p++) comando.apply(null, pendentes[p]);
  } catch { /* ignora */ }
})(window);
