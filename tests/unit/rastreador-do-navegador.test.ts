import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O SCRIPT DO RASTREADOR (`public/deskcomm-rastreador.js`) num navegador simulado.
 *
 * O arquivo é executado de verdade, com uma `window` de mentira que registra tudo o que ele faz: requisições, beacons,
 * armazenamento e avisos no console. O tempo é o do vitest (relógio falso), então "a cada 3 segundos" é medido, não
 * suposto. Nada aqui lê o código do script: o que se afirma é comportamento observável.
 */

const FONTE = readFileSync("public/deskcomm-rastreador.js", "utf8");
const CHAVE = `pk_${"a1".repeat(18)}`;
const IDTRACK = "6a3a1d29-e054-4f33-b406-dcb90ff9c948";
const ENDPOINT = "https://crm.exemplo";
const URL_DA_COLETA = `${ENDPOINT}/api/v1/coleta/${CHAVE}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Resposta = { status: number; retryAfter?: string; corpo?: unknown };

function memoria() {
  const dados = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => (dados.has(k) ? dados.get(k)! : null)),
    setItem: vi.fn((k: string, v: string) => void dados.set(k, v)),
    removeItem: vi.fn((k: string) => void dados.delete(k)),
    dados,
  };
}

interface Opcoes {
  search?: string;
  sessao?: ReturnType<typeof memoria>;
  local?: ReturnType<typeof memoria>;
  respostas?: Array<Resposta | "rede">;
  semBeacon?: boolean;
  fila?: unknown[][];
}

function montar(o: Opcoes = {}) {
  const sessao = o.sessao ?? memoria();
  const local = o.local ?? memoria();
  const roteiro = [...(o.respostas ?? [])];
  const eventosDaPagina: Record<string, Array<() => void>> = {};
  const eventosDoDocumento: Record<string, Array<() => void>> = {};
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
    const proxima = roteiro.length > 0 ? roteiro.shift()! : ({ status: 200 } as Resposta);
    if (proxima === "rede") throw new TypeError("Failed to fetch");
    return {
      status: proxima.status,
      headers: { get: (n: string) => (n.toLowerCase() === "retry-after" ? proxima.retryAfter ?? null : null) },
      json: async () => proxima.corpo ?? { data: { eventos: [] } },
    };
  });
  const sendBeacon = vi.fn((_url: string, _corpo: Blob) => true);
  const aviso = vi.fn();
  let n = 0;
  const w: Record<string, unknown> = {
    document: {
      currentScript: { src: `${ENDPOINT}/deskcomm-rastreador.js` },
      visibilityState: "visible",
      addEventListener: (nome: string, f: () => void) => (eventosDoDocumento[nome] ??= []).push(f),
    },
    location: { search: o.search ?? `?idtrack=${IDTRACK}` },
    sessionStorage: sessao,
    localStorage: local,
    navigator: o.semBeacon ? {} : { sendBeacon },
    Blob,
    fetch,
    setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    console: { warn: aviso },
    crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` },
    addEventListener: (nome: string, f: () => void) => (eventosDaPagina[nome] ??= []).push(f),
  };
  if (o.fila) w.deskcomm = Object.assign(() => undefined, { q: o.fila });
  new Function("window", FONTE)(w);
  const deskcomm = w.deskcomm as ((...a: unknown[]) => void) & Record<string, (...a: unknown[]) => void>;
  return {
    w, deskcomm, fetch, sendBeacon, aviso, sessao, local,
    sair: () => eventosDaPagina.pagehide?.forEach((f) => f()),
    esconder: () => {
      (w.document as { visibilityState: string }).visibilityState = "hidden";
      eventosDoDocumento.visibilitychange?.forEach((f) => f());
    },
    corpo: (i = 0) => JSON.parse(String(fetch.mock.calls[i]![1].body)) as {
      idtrack: string; events: Array<{ event: string; event_id: string; at: string; data?: Record<string, unknown> }>; debug?: boolean;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const iniciar = (t: ReturnType<typeof montar>, extra: Record<string, unknown> = {}) =>
  t.deskcomm("init", { key: CHAVE, ...extra });
const esperar = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe("a API manual", () => {
  it("expõe init, track, optOut e optIn tanto como comando quanto como método", () => {
    const t = montar();
    for (const m of ["init", "track", "optOut", "optIn", "flush"]) expect(typeof t.deskcomm[m]).toBe("function");
  });

  it("as chamadas feitas ANTES de o arquivo carregar (fila `q` do trecho de instalação) são executadas", async () => {
    const t = montar({ fila: [["init", { key: CHAVE }], ["track", "page_view", { screen_name: "home" }]] });
    await esperar(3000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.corpo().events[0]).toMatchObject({ event: "page_view", data: { screen_name: "home" } });
  });

  it("⭐ não observa a página por conta própria: sem atributos HTML, sem dataLayer, sem clique", () => {
    // Sem os comentários: o cabeçalho do arquivo cita o `dataLayer` justamente para dizer que NÃO o lê.
    const codigo = FONTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(codigo).not.toMatch(/dataLayer/);
    expect(codigo).not.toMatch(/MutationObserver/);
    expect(codigo).not.toMatch(/querySelector|getElementsBy|data-deskcomm/);
    expect(codigo).not.toMatch(/addEventListener\(\s*["'](click|submit|input)/);
  });
});

describe("fila e envio em lote", () => {
  it("⭐ track não envia na hora: o lote sai 3 segundos depois, para a chave certa, com idtrack e event_id UUID", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view", { screen_name: "home" });
    expect(t.fetch).not.toHaveBeenCalled();
    await esperar(2999);
    expect(t.fetch).not.toHaveBeenCalled();
    await esperar(1);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.fetch.mock.calls[0]![0]).toBe(URL_DA_COLETA);
    const corpo = t.corpo();
    expect(corpo.idtrack).toBe(IDTRACK);
    expect(corpo.events).toHaveLength(1);
    expect(corpo.events[0]!.event_id).toMatch(UUID);
    expect(Date.parse(corpo.events[0]!.at)).not.toBeNaN();
  });

  it("a requisição é simples: text/plain (sem preflight), sem cookies, e a chave só no caminho", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    const init = t.fetch.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("text/plain");
    expect(init.credentials).toBe("omit");
    expect(init.method).toBe("POST");
    expect(t.fetch.mock.calls[0]![0]).not.toContain("?");
    expect(String(init.body)).not.toContain(CHAVE);
  });

  it("⭐ vários eventos no intervalo viram UM lote; 20 acumulados saem na hora", async () => {
    const t = montar();
    iniciar(t);
    for (let i = 0; i < 3; i++) t.deskcomm("track", "view_item", { item_id: `i${i}` });
    await esperar(3000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.corpo().events).toHaveLength(3);

    const u = montar();
    iniciar(u);
    for (let i = 0; i < 20; i++) u.deskcomm("track", "view_item", { item_id: `i${i}` });
    await esperar(0);
    expect(u.fetch).toHaveBeenCalledTimes(1);
    expect(u.corpo().events).toHaveLength(20);
  });

  it("⭐ 25 eventos: lote de 20 na hora e os 5 restantes no intervalo seguinte", async () => {
    const t = montar();
    iniciar(t);
    for (let i = 0; i < 25; i++) t.deskcomm("track", "view_item", { item_id: `i${i}` });
    await esperar(0);
    expect(t.corpo(0).events).toHaveLength(20);
    await esperar(3000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.corpo(1).events.map((e) => e.data?.item_id)).toEqual(["i20", "i21", "i22", "i23", "i24"]);
  });

  it("evento confirmado (200) não é enviado de novo", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    await esperar(60000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it("nome de evento inválido é descartado antes da fila", async () => {
    const t = montar();
    iniciar(t, { debug: true });
    t.deskcomm("track", "Page View");
    t.deskcomm("track", 42);
    t.deskcomm("track");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it("⭐ a fila tem teto de 200: com o envio travado, os mais antigos caem e os mais novos sobrevivem", async () => {
    const t = montar();
    iniciar(t);
    let liberar: (r: unknown) => void = () => undefined;
    t.fetch.mockImplementationOnce(
      () => new Promise((resolve) => { liberar = resolve; }) as never,
    );
    for (let i = 0; i < 230; i++) t.deskcomm("track", "view_item", { n: i });
    await esperar(0);
    liberar({ status: 200, headers: { get: () => null }, json: async () => ({}) });
    await esperar(60000);
    const depois = t.fetch.mock.calls.slice(1).flatMap((_c, i) => t.corpo(i + 1).events.map((e) => e.data?.n as number));
    expect(new Set(depois).size).toBe(200);
    expect(Math.min(...depois)).toBe(30);
    expect(Math.max(...depois)).toBe(229);
  });
});

describe("reenvio: só falha de rede e 5xx; a recusa é definitiva", () => {
  it("⭐ falha de rede: o MESMO event_id é reenviado e, confirmado, para", async () => {
    const t = montar({ respostas: ["rede", { status: 200 }] });
    iniciar(t);
    t.deskcomm("track", "purchase", { value: 10 });
    await esperar(3000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await esperar(60000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.corpo(1).events[0]!.event_id).toBe(t.corpo(0).events[0]!.event_id);
    await esperar(120000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it("5xx também é reenviado, com o mesmo event_id", async () => {
    const t = montar({ respostas: [{ status: 503 }, { status: 200 }] });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    await esperar(60000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
    expect(t.corpo(1).events[0]!.event_id).toBe(t.corpo(0).events[0]!.event_id);
  });

  it("⭐ 429 respeita o Retry-After do servidor", async () => {
    const t = montar({ respostas: [{ status: 429, retryAfter: "20" }, { status: 200 }] });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    await esperar(19000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    await esperar(1000);
    expect(t.fetch).toHaveBeenCalledTimes(2);
  });

  it.each([403, 404, 422])("⭐ HTTP %i é recusa DEFINITIVA: não reenvia, nem muito depois", async (status) => {
    const t = montar({ respostas: [{ status }] });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    await esperar(600000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
  });

  it("desiste depois de muitas falhas seguidas (não tenta para sempre)", async () => {
    const t = montar({ respostas: Array(50).fill("rede") });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    await esperar(3_600_000);
    expect(t.fetch.mock.calls.length).toBeLessThanOrEqual(7);
    const n = t.fetch.mock.calls.length;
    await esperar(3_600_000);
    expect(t.fetch.mock.calls.length).toBe(n);
  });
});

describe("ao sair da página", () => {
  it("⭐ pagehide manda o que sobrou por sendBeacon (text/plain) e esvazia a fila", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    t.sair();
    expect(t.sendBeacon).toHaveBeenCalledTimes(1);
    expect(t.sendBeacon.mock.calls[0]![0]).toBe(URL_DA_COLETA);
    const blob = t.sendBeacon.mock.calls[0]![1];
    expect(blob.type).toContain("text/plain");
    expect(JSON.parse(await blob.text()).events[0]).toMatchObject({ event: "page_view" });
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it("a aba que fica oculta também descarrega a fila", () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    t.esconder();
    expect(t.sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("sem sendBeacon cai no fetch com keepalive", () => {
    const t = montar({ semBeacon: true });
    iniciar(t);
    t.deskcomm("track", "page_view");
    t.sair();
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.fetch.mock.calls[0]![1].keepalive).toBe(true);
  });

  it("fila vazia: nada é enviado ao sair", () => {
    const t = montar();
    iniciar(t);
    t.sair();
    expect(t.sendBeacon).not.toHaveBeenCalled();
  });
});

describe("⭐ a falha do script nunca quebra a página", () => {
  it("comandos antes do init, comandos desconhecidos e argumentos absurdos não lançam", () => {
    const t = montar();
    expect(() => {
      t.deskcomm("track", "page_view");
      t.deskcomm("nao-existe");
      t.deskcomm("init");
      t.deskcomm("init", null);
      t.deskcomm("init", { key: 42 });
      t.deskcomm();
    }).not.toThrow();
  });

  it("dados com referência circular não derrubam o track", () => {
    const t = montar();
    iniciar(t);
    const circular: Record<string, unknown> = { a: 1 };
    circular.eu = circular;
    expect(() => t.deskcomm("track", "page_view", circular)).not.toThrow();
  });

  it("fetch que lança de forma síncrona não escapa", async () => {
    const t = montar();
    iniciar(t);
    t.fetch.mockImplementation(() => {
      throw new Error("boom");
    });
    t.deskcomm("track", "page_view");
    await expect(esperar(3000)).resolves.not.toThrow();
  });

  it("sendBeacon que lança na saída não escapa", () => {
    const t = montar();
    iniciar(t);
    t.sendBeacon.mockImplementation(() => {
      throw new Error("boom");
    });
    t.deskcomm("track", "page_view");
    expect(() => t.sair()).not.toThrow();
  });

  it("chave que não é a chave pública do funil: init recusa e nada é enviado", async () => {
    const t = montar();
    t.deskcomm("init", { key: "dsk_segredo_de_servidor" });
    t.deskcomm("track", "page_view");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// US-027: idtrack, privacidade e depuração
// ---------------------------------------------------------------------------

describe("idtrack", () => {
  it("⭐ lê o idtrack da URL (UUID), guarda na sessão e envia em minúsculas", async () => {
    const t = montar({ search: `?utm=1&idtrack=${IDTRACK.toUpperCase()}#topo` });
    iniciar(t);
    expect(t.sessao.setItem).toHaveBeenCalledWith("deskcomm_idtrack", IDTRACK);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    expect(t.corpo().idtrack).toBe(IDTRACK);
  });

  it("⭐ na página seguinte, sem idtrack na URL, usa o que a sessão guardou", async () => {
    const sessao = memoria();
    sessao.dados.set("deskcomm_idtrack", IDTRACK);
    const t = montar({ search: "", sessao });
    iniciar(t);
    t.deskcomm("track", "view_item");
    await esperar(3000);
    expect(t.corpo().idtrack).toBe(IDTRACK);
  });

  it.each([
    ["telefone", "+5517982290042"],
    ["telefone sem sinal", "5517982290042"],
    ["e-mail", "alguem@exemplo.com"],
    ["texto", "abc"],
    ["UUID truncado", IDTRACK.slice(0, 35)],
    ["UUID com lixo", `${IDTRACK}x`],
    ["vazio", ""],
  ])("⭐ idtrack inválido (%s): não envia NADA e não guarda nada", async (_nome, valor) => {
    const t = montar({ search: `?idtrack=${encodeURIComponent(valor)}` });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
    expect(t.sessao.setItem).not.toHaveBeenCalled();
  });

  it("⭐ sem idtrack nenhum (e nada guardado): não envia nada", async () => {
    const t = montar({ search: "" });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
  });

  it("idtrack inválido na sessão guardada também é ignorado", async () => {
    const sessao = memoria();
    sessao.dados.set("deskcomm_idtrack", "+5517982290042");
    const t = montar({ search: "", sessao });
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
  });
});

describe("privacidade", () => {
  it("⭐ storage:false não guarda NADA no navegador, e o idtrack da URL vale só enquanto a página vive", async () => {
    const t = montar();
    iniciar(t, { storage: false });
    t.deskcomm("track", "page_view");
    await esperar(3000);
    expect(t.fetch).toHaveBeenCalledTimes(1);
    expect(t.sessao.setItem).not.toHaveBeenCalled();
    expect(t.local.setItem).not.toHaveBeenCalled();
    t.deskcomm("optOut");
    expect(t.local.setItem).not.toHaveBeenCalled();
    // A "próxima página": sem URL com idtrack e sem nada guardado, nada é enviado.
    const outra = montar({ search: "" });
    iniciar(outra, { storage: false });
    outra.deskcomm("track", "page_view");
    await esperar(10000);
    expect(outra.fetch).not.toHaveBeenCalled();
  });

  it("⭐ optOut apaga o que foi guardado, esvazia a fila e para de enviar", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    t.deskcomm("optOut");
    expect(t.sessao.dados.has("deskcomm_idtrack")).toBe(false);
    t.deskcomm("track", "view_item");
    await esperar(10000);
    expect(t.fetch).not.toHaveBeenCalled();
    t.sair();
    expect(t.sendBeacon).not.toHaveBeenCalled();
  });

  it("⭐ a escolha de sair vale nas páginas seguintes (marcador no navegador) e optIn a desfaz", async () => {
    const local = memoria();
    const sessao = memoria();
    const a = montar({ local, sessao });
    iniciar(a);
    a.deskcomm("optOut");
    expect(local.dados.get("deskcomm_optout")).toBe("1");

    const b = montar({ local, sessao });
    iniciar(b);
    b.deskcomm("track", "page_view");
    await esperar(10000);
    expect(b.fetch).not.toHaveBeenCalled();
    expect(sessao.dados.has("deskcomm_idtrack")).toBe(false);

    b.deskcomm("optIn");
    expect(local.dados.has("deskcomm_optout")).toBe(false);
    b.deskcomm("track", "page_view");
    await esperar(3000);
    expect(b.fetch).toHaveBeenCalledTimes(1);
  });

  it("⭐ nunca envia telefone, e-mail nem nome: as chaves pessoais saem em qualquer profundidade", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "purchase", {
      order_id: "P-1",
      value: 73.9,
      item_name: "Pizza grande",
      phone: "+5517982290042",
      Telefone: "17982290042",
      email: "a@b.com",
      name: "Maria",
      customer: { full_name: "Maria da Silva", cpf: "000", cidade: "Rio Preto" },
      itens: [{ item_name: "Coca", nome: "Maria", qtd: 2 }],
    });
    await esperar(3000);
    const data = t.corpo().events[0]!.data!;
    expect(data).toEqual({
      order_id: "P-1",
      value: 73.9,
      item_name: "Pizza grande",
      customer: { cidade: "Rio Preto" },
      itens: [{ item_name: "Coca", qtd: 2 }],
    });
    expect(JSON.stringify(t.corpo())).not.toMatch(/5517982290042|a@b\.com|Maria/);
  });

  it("valor que parece e-mail sai mesmo sob uma chave inocente", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view", { observacao: "fale com maria@exemplo.com", tela: "home" });
    await esperar(3000);
    expect(t.corpo().events[0]!.data).toEqual({ tela: "home" });
  });
});

describe("modo de depuração", () => {
  const resposta = (cadastradas: string[]): Resposta => ({
    status: 200,
    corpo: { data: { eventos: [], chaves_cadastradas: cadastradas } },
  });

  it("⭐ avisa no console quando a chave do evento não existe, usando a lista da resposta, uma vez por chave", async () => {
    const t = montar({ respostas: [resposta(["page_view", "purchase"]), resposta(["page_view", "purchase"])] });
    iniciar(t, { debug: true });
    t.deskcomm("track", "page_view");
    t.deskcomm("track", "carrinho_abandonado");
    await esperar(3000);
    const avisos = t.aviso.mock.calls.map((c) => c.join(" "));
    expect(avisos.filter((a) => a.includes("carrinho_abandonado"))).toHaveLength(1);
    expect(avisos.join(" ")).toContain("page_view, purchase");
    expect(avisos.some((a) => a.includes('"page_view"'))).toBe(false);
    t.deskcomm("track", "carrinho_abandonado");
    await esperar(3000);
    expect(t.aviso.mock.calls.map((c) => c.join(" ")).filter((a) => a.includes("carrinho_abandonado"))).toHaveLength(1);
  });

  it("⭐ pede a lista só em modo de depuração (debug no corpo) e não faz barulho fora dele", async () => {
    const t = montar();
    iniciar(t);
    t.deskcomm("track", "page_view");
    await esperar(3000);
    expect(t.corpo().debug).toBeUndefined();
    expect(t.aviso).not.toHaveBeenCalled();

    const d = montar();
    iniciar(d, { debug: true });
    d.deskcomm("track", "page_view");
    await esperar(3000);
    expect(d.corpo().debug).toBe(true);
  });

  it("explica no console por que nada é enviado quando falta o idtrack", () => {
    const t = montar({ search: "" });
    iniciar(t, { debug: true });
    expect(t.aviso.mock.calls.flat().join(" ")).toContain("idtrack");
  });

  it("avisa quando o CRM recusa o lote (e não reenvia)", async () => {
    const t = montar({ respostas: [{ status: 403 }] });
    iniciar(t, { debug: true });
    t.deskcomm("track", "page_view");
    await esperar(3000);
    expect(t.aviso.mock.calls.flat().join(" ")).toContain("403");
  });
});
