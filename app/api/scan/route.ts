import { DatabaseSync } from "node:sqlite";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/* =========================================================
   TIPOS
========================================================= */

type PokemonRow = {
  id: number;
  national_dex_number: number;
  name: string;
  image: string | null;
  type1: string | null;
  type2: string | null;
  generation: number | null;
};

type CardPrice = {
  low?: number;
  mid?: number;
  high?: number;
  market?: number;
};

type CardResult = {
  id: string;
  name: string;
  number: string;
  imageUrl?: string;
  supertype?: string;
  subtypes?: string[];
  rarity?: string;
  attacks?: { name?: string; text?: string; damage?: string }[];
  abilities?: { name?: string; text?: string }[];
  flavorText?: string;

  nationalPokedexNumbers?: number[];

  set?: {
    id?: string;
    name?: string;
    series?: string;
    releaseDate?: string;
  };

  images?: {
    small?: string;
    large?: string;
  };

  tcgplayer?: {
    updatedAt?: string;
    prices?: Record<string, CardPrice>;
  };
};

type GenericCardMatch = {
  card: CardResult;
  confidence: number;
  type: "Trainer" | "Energy";
};

type CardCandidate = {
  card: CardResult;
  confidence: number;
  reasons: string[];
};

/* =========================================================
   CACHE SIMPLES EM MEMÓRIA

   Ajuda principalmente em desenvolvimento, evitando consultar
   novamente a mesma busca a cada tentativa da câmera.
========================================================= */

const apiCache = new Map<
  string,
  {
    expiresAt: number;
    cards: CardResult[];
  }
>();

const CACHE_TTL_MS = 60_000;

function getDatabase() {
  return new DatabaseSync("pokescan.sqlite");
}

/* =========================================================
   NORMALIZAÇÃO
========================================================= */

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(text: string) {
  return normalize(text)
    .replace(/[/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOcrAliases(text: string) {
  return text
    .replace(/\bfloste\b/gi, "Floette")
    .replace(/\bfloete\b/gi, "Floette")
    .replace(/\bbergute\b/gi, "Bergmite")
    .replace(/\bbergmue\b/gi, "Bergmite")
    .replace(/\bbergrmite\b/gi, "Bergmite")
    .replace(/\bber gmite\b/gi, "Bergmite")
    .replace(/\bho\s*[-]?\s*oh\b/gi, "Ho-Oh")
    .replace(/\bhooh\b/gi, "Ho-Oh")
    .replace(/\bh[- ]?oh\b/gi, "Ho-Oh");
}

/* =========================================================
   PALAVRAS OCR
========================================================= */

function getWords(text: string) {
  return normalizeLoose(text)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

function cleanOcrWords(text: string) {
  const ignored = new Set([
    "pokemon",
    "basic",
    "stage",
    "hp",
    "trainer",
    "treinador",
    "energy",
    "energia",
    "retreat",
    "weakness",
    "resistance",
    "illustrator",
    "attack",
    "damage",
    "rule",
    "rules",
    "fraqueza",
    "resistencia",
    "recuo",
    "ataque",
    "dano",
    "basica",
    "basica",
    "item",
    "tool",
    "ferramenta",
    "stadium",
    "estadio",
    "supporter",
    "apoiador",
  ]);

  return getWords(text).filter((word) => {
    if (ignored.has(word)) return false;
    if (/^\d+$/.test(word)) return false;
    return word.length >= 3;
  });
}

/* =========================================================
   DISTÂNCIA / SIMILARIDADE
========================================================= */

function levenshteinDistance(a: string, b: string) {
  const matrix = Array.from(
    { length: b.length + 1 },
    () => Array(a.length + 1).fill(0)
  );

  for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(
              matrix[i - 1][j] + 1,
              matrix[i][j - 1] + 1,
              matrix[i - 1][j - 1] + 1
            );
    }
  }

  return matrix[b.length][a.length];
}

function textSimilarity(a: string, b: string) {
  const left = normalizeLoose(a);
  const right = normalizeLoose(b);

  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.92;

  const distance = levenshteinDistance(left, right);

  return 1 - distance / Math.max(left.length, right.length);
}

/* =========================================================
   NÚMERO DA CARTA — SOMENTE PADRÕES CONFIÁVEIS

   Não aceitamos número isolado como "4" ou "3", pois OCR
   costuma transformar HP, custo, dano etc. em números.
========================================================= */

function getCardNumber(text: string) {
  const normalized = normalize(text)
    .replace(/\bO\b/g, "0")
    .replace(/\bI\b/g, "1")
    .replace(/\bL\b/g, "1")
    .replace(/\bS\b/g, "5");

  const patterns = [
    /(\d{1,3})\s*\/\s*(\d{1,3})/,
    /(\d{1,3})\s*-\s*(\d{1,3})/,
    /#\s*(\d{1,3})/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);

    if (match?.[1]) {
      console.log(
        "🔢 Número confiável encontrado pelo OCR:",
        match[1]
      );

      return match[1];
    }
  }

  console.log("🔢 Número da carta não identificado por padrão confiável.");
  return null;
}

function getFooterNumber(text: string) {
  const normalized = normalize(text)
    .replace(/\bO\b/g, "0")
    .replace(/\bI\b/g, "1")
    .replace(/\bL\b/g, "1")
    .replace(/\bS\b/g, "5");

  const matches = [...normalized.matchAll(/\b(\d{1,3})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 300);

  if (!matches.length) return null;
  return String(matches[matches.length - 1]);
}

function normalizeCardNumber(value: string | null | undefined) {
  if (!value) return null;
  return String(value).replace(/^0+/, "") || "0";
}

function cardNumberMatches(
  card: CardResult,
  cardNumber: string | null
) {
  if (!cardNumber) return false;

  return (
    normalizeCardNumber(card.number) ===
    normalizeCardNumber(cardNumber)
  );
}

/* =========================================================
   TIPO DA CARTA
========================================================= */

function isLikelyEnergyText(text: string) {
  const normalized = normalize(text);
  return /\b(energy|energia|energi|basica|basic)\b/.test(normalized);
}

function isLikelyTrainerText(text: string) {
  const normalized = normalize(text);
  return /\b(trainer|treinador|estadio|stadium|supporter|apoiador|item|tool|ferramenta)\b/.test(
    normalized
  );
}

function detectEnergyType(text: string, visualHint?: string | null) {
  const supported = [
    "Grass Energy",
    "Fire Energy",
    "Water Energy",
    "Lightning Energy",
    "Psychic Energy",
    "Fighting Energy",
    "Darkness Energy",
    "Metal Energy",
    "Fairy Energy",
    "Dragon Energy",
  ];

  if (visualHint) {
    const normalizedHint = normalizeLoose(visualHint);
    const match = supported.find(
      (item) => normalizeLoose(item) === normalizedHint
    );
    if (match) return match;
  }

  const normalized = normalizeLoose(text);

  const types = [
    { names: ["grass", "grama", "planta", "folha", "leaf"], name: "Grass Energy" },
    { names: ["fire", "fogo", "flame", "chama"], name: "Fire Energy" },
    { names: ["water", "agua"], name: "Water Energy" },
    { names: ["lightning", "eletrica", "eletricidade", "raio", "electric"], name: "Lightning Energy" },
    { names: ["psychic", "psiquica", "psiquico"], name: "Psychic Energy" },
    { names: ["fighting", "luta"], name: "Fighting Energy" },
    { names: ["darkness", "sombria", "escuridao", "dark"], name: "Darkness Energy" },
    { names: ["metal", "aco"], name: "Metal Energy" },
    { names: ["fairy", "fada"], name: "Fairy Energy" },
    { names: ["dragon", "dragao"], name: "Dragon Energy" },
  ];

  for (const type of types) {
    if (type.names.some((name) => normalized.includes(normalizeLoose(name)))) {
      return type.name;
    }
  }

  return null;
}

/* =========================================================
   ENCONTRAR POKÉMON NO BANCO
========================================================= */

function findPokemonFromText(text: string): PokemonRow | null {
  const db = getDatabase();

  try {
    const pokemon = db
      .prepare(`
        SELECT
          id,
          national_dex_number,
          name,
          image,
          type1,
          type2,
          generation
        FROM pokemon
      `)
      .all() as PokemonRow[];

    const normalizedText = normalizeLoose(normalizeOcrAliases(text));
    const rawWords = normalizedText
      .split(/\s+/)
      .filter((word) => word.length >= 2);

    console.log("🔤 Palavras consideradas pelo OCR:", rawWords);

    /* Correspondência exata do nome. */
    let bestExact: PokemonRow | null = null;
    let bestExactLength = 0;

    for (const candidate of pokemon) {
      const candidateName = normalizeLoose(candidate.name);

      if (candidateName.length < 3) continue;

      if (normalizedText.includes(candidateName)) {
        if (candidateName.length > bestExactLength) {
          bestExact = candidate;
          bestExactLength = candidateName.length;
        }
      }
    }

    if (bestExact) {
      console.log(
        "✅ Pokémon encontrado por correspondência exata:",
        bestExact.name
      );
      return bestExact;
    }

    /* Janelas para nomes compostos. */
    const windows: string[] = [];

    for (let size = 1; size <= 3; size++) {
      for (let i = 0; i <= rawWords.length - size; i++) {
        windows.push(rawWords.slice(i, i + size).join(" "));
      }
    }

    let bestMatch: PokemonRow | null = null;
    let bestSimilarity = 0;

    for (const candidate of pokemon) {
      const candidateName = normalizeLoose(candidate.name);

      if (candidateName.length < 4) continue;

      for (const window of windows) {
        if (Math.abs(window.length - candidateName.length) > 4) continue;

        const distance = levenshteinDistance(window, candidateName);
        const similarity =
          1 - distance / Math.max(window.length, candidateName.length);

        if (similarity > bestSimilarity) {
          bestSimilarity = similarity;
          bestMatch = candidate;
        }
      }
    }

    console.log("📊 Melhor resultado:", bestMatch?.name);
    console.log(
      "📊 Melhor similaridade:",
      bestSimilarity.toFixed(3)
    );

    /*
     * Aproximação conservadora. Isso evita o caso Ho-Oh -> Seel.
     */
    if (bestMatch && bestSimilarity >= 0.78) {
      console.log(
        "✅ Pokémon encontrado por similaridade segura:",
        bestMatch.name
      );
      return bestMatch;
    }

    console.log(
      "❌ Nenhum Pokémon atingiu o nível mínimo seguro de similaridade."
    );

    return null;
  } finally {
    db.close();
  }
}

/* =========================================================
   API TCG — QUERY
========================================================= */

function escapeQueryValue(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  attempts = 2
) {
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      console.log(
        `🌐 Consulta Pokémon TCG API - tentativa ${attempt}/${attempts}`
      );

      const response = await fetch(url, {
        ...options,
        cache: "no-store",
      });

      lastResponse = response;

      console.log("📡 Status da API:", response.status);

      if (response.ok) return response;

      const retryable = [429, 500, 502, 503, 504].includes(
        response.status
      );

      if (!retryable) return response;

      if (attempt < attempts) {
        const delay = 350 * Math.pow(2, attempt - 1);

        console.log(
          `⏳ Aguardando ${delay}ms antes da próxima tentativa...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      console.error("❌ Erro de conexão com Pokémon TCG API:", error);

      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
      }
    }
  }

  if (lastResponse) return lastResponse;

  throw new Error("Não foi possível conectar à Pokémon TCG API.");
}

async function searchCardsByQuery(query: string) {
  const cached = apiCache.get(query);

  if (cached && cached.expiresAt > Date.now()) {
    console.log("💾 Usando cache para query:", query);
    return {
      success: true,
      cards: cached.cards,
      status: 200,
    };
  }

  const url = new URL("https://api.pokemontcg.io/v2/cards");

  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "250");

  console.log("🔎 Query enviada para Pokémon TCG API:", query);

  const headers: HeadersInit = {};

  if (process.env.POKEMON_TCG_API_KEY) {
    headers["X-Api-Key"] = process.env.POKEMON_TCG_API_KEY;
  }

  const response = await fetchWithRetry(url.toString(), { headers });

  if (!response.ok) {
    let details = "";

    try {
      details = await response.text();
    } catch {
      // Ignora erro adicional.
    }

    console.error(
      "❌ Pokémon TCG API falhou:",
      response.status,
      details
    );

    return {
      success: false,
      cards: [] as CardResult[],
      status: response.status,
    };
  }

  const data = await response.json();

  const cards = Array.isArray(data.data)
    ? (data.data as CardResult[])
    : [];

  apiCache.set(query, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    cards,
  });

  console.log(`🃏 ${cards.length} carta(s) retornada(s).`);

  return {
    success: true,
    cards,
    status: response.status,
  };
}

/* =========================================================
   EVIDÊNCIAS DE COLEÇÃO / SET
========================================================= */

const SET_ALIASES: Record<string, string[]> = {
  "chaos rising": ["chaos rising", "chaos ascending", "caos ascendente", "caos ascendente pokemon"],
  "flashfire": ["flashfire", "chamas escaldantes", "chamas do fogo"],
};

function canonicalSetName(name: string | undefined) {
  if (!name) return "";

  const normalized = normalizeLoose(name);

  for (const [canonical, aliases] of Object.entries(SET_ALIASES)) {
    if (
      aliases.some((alias) => {
        const a = normalizeLoose(alias);
        return normalized === a || normalized.includes(a) || a.includes(normalized);
      })
    ) {
      return canonical;
    }
  }

  return normalized;
}

function extractSetEvidence(text: string) {
  const normalized = normalizeLoose(text);

  const evidence = new Set<string>();

  for (const [canonical, aliases] of Object.entries(SET_ALIASES)) {
    if (
      aliases.some((alias) => normalized.includes(normalizeLoose(alias)))
    ) {
      evidence.add(canonical);
    }
  }

  return [...evidence];
}

function scoreSetMatch(
  card: CardResult,
  text: string,
  setEvidence: string[]
) {
  if (!card.set?.name) return 0;

  const cardSet = canonicalSetName(card.set.name);
  const normalizedText = normalizeLoose(text);
  let score = 0;

  if (setEvidence.includes(cardSet)) {
    score += 0.45;
  }

  if (normalizedText.includes(normalizeLoose(card.set.name))) {
    score += 0.35;
  }

  const cardSetWords = cardSet.split(/\s+/).filter((word) => word.length >= 4);
  const ocrWords = cleanOcrWords(text);

  for (const setWord of cardSetWords) {
    const best = Math.max(
      0,
      ...ocrWords.map((word) => textSimilarity(word, setWord))
    );

    if (best >= 0.90) score += 0.12;
    else if (best >= 0.80) score += 0.08;
  }

  return Math.min(0.55, score);
}

/* =========================================================
   SCORE DA IMPRESSÃO DO POKÉMON

   IMPORTANTE:
   - espécie não significa impressão;
   - sem número/set, NÃO usamos cards[0];
   - se não houver evidência suficiente, devolvemos null.
========================================================= */

function scorePokemonCardCandidate(
  card: CardResult,
  pokemon: PokemonRow,
  text: string,
  cardNumber: string | null
): CardCandidate {
  let confidence = 0;
  const reasons: string[] = [];

  if (cardNumberMatches(card, cardNumber)) {
    confidence += 0.70;
    reasons.push("número exato");
  }

  const setEvidence = extractSetEvidence(text);
  const setScore = scoreSetMatch(card, text, setEvidence);

  if (setScore > 0) {
    confidence += setScore;
    reasons.push("coleção compatível");
  }

  const normalizedText = normalizeLoose(text);
  const cardName = normalizeLoose(card.name);

  if (normalizedText.includes(cardName)) {
    confidence += 0.10;
    reasons.push("nome da carta");
  }

  const dexNumber = String(pokemon.national_dex_number);

  if (
    normalizedText.includes(` ${dexNumber} `) ||
    normalizedText.includes(`n ${dexNumber}`)
  ) {
    confidence += 0.04;
    reasons.push("número nacional");
  }

  /*
   * Se não há número nem set, não damos confiança artificial.
   * Isso é proposital para impedir que outra impressão seja escolhida.
   */

  return {
    card,
    confidence: Math.min(1, confidence),
    reasons,
  };
}

async function searchPokemonCardCandidates(
  pokemon: PokemonRow,
  text: string,
  cardNumber: string | null
) {
  const pokemonName = escapeQueryValue(pokemon.name);

  let result = await searchCardsByQuery(`name:${pokemonName}`);

  if (!result.success || !result.cards.length) {
    console.log(
      "🔁 Busca pelo nome falhou; tentando National Dex:",
      pokemon.national_dex_number
    );

    result = await searchCardsByQuery(
      `nationalPokedexNumbers:${pokemon.national_dex_number}`
    );
  }

  if (!result.success || !result.cards.length) {
    return [] as CardCandidate[];
  }

  const candidates = result.cards.map((card) =>
    scorePokemonCardCandidate(
      card,
      pokemon,
      text,
      cardNumber
    )
  );

  candidates.sort((a, b) => b.confidence - a.confidence);

  return candidates;
}

function choosePokemonCard(
  candidates: CardCandidate[],
  cardNumber: string | null
) {
  if (!candidates.length) return null;

  /*
   * Nova estratégia deliberadamente simples e estável:
   *
   * 1. Se o OCR encontrou o número exato, usamos essa impressão.
   * 2. Caso contrário, aceitamos a melhor carta retornada para o Pokémon.
   *
   * O objetivo nesta etapa é NÃO bloquear o reconhecimento do Pokémon
   * apenas porque a câmera não conseguiu descobrir a impressão exata.
   */
  const exactNumber = cardNumber
    ? candidates.find((candidate) =>
        cardNumberMatches(candidate.card, cardNumber)
      )
    : null;

  const selected = exactNumber?.card ?? candidates[0].card;

  console.log(
    exactNumber
      ? "🎯 Impressão escolhida pelo número OCR:"
      : "🃏 Usando uma impressão de referência do Pokémon:",
    selected.id,
    selected.name,
    selected.set?.name,
    selected.number
  );

  if (!exactNumber) {
    console.log(
      "ℹ️ A impressão exata da foto não foi confirmada. O Pokémon será mostrado mesmo assim."
    );
  }

  return selected;
}

/* =========================================================
   LISTAS DE TRAINER / ENERGY COM CACHE
========================================================= */

async function getAllCardsBySupertype(
  supertype: "Trainer" | "Energy"
) {
  const result = await searchCardsByQuery(
    `supertype:${supertype}`
  );

  return result.success ? result.cards : [];
}

function scoreGenericCard(
  card: CardResult,
  words: string[],
  text: string,
  type: "Trainer" | "Energy",
  cardNumber: string | null,
  energyHint?: string | null
) {
  const cardName = normalizeLoose(card.name);
  const normalizedText = normalizeLoose(text);
  let score = 0;

  const detectedEnergy = detectEnergyType(text, energyHint);

  if (type === "Energy" && detectedEnergy) {
    const energyRoot = normalizeLoose(
      detectedEnergy.replace(/\s+energy$/i, "")
    );

    if (!cardName.includes(energyRoot)) {
      return 0;
    }

    score += 0.72;

    if (
      cardName === normalizeLoose(detectedEnergy) ||
      cardName.includes(normalizeLoose(detectedEnergy))
    ) {
      score += 0.18;
    }
  }

  if (
    type === "Energy" &&
    !detectedEnergy &&
    !/\b(energy|energia|energi|basica|basic)\b/.test(normalizedText)
  ) {
    return 0;
  }

  if (cardNumberMatches(card, cardNumber)) {
    score += 0.60;
  }

  if (normalizedText.includes(cardName)) {
    score += 0.55;
  }

  const nameTokens = cardName
    .replace(/[\/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  for (const word of words) {
    const bestToken = Math.max(
      0,
      ...nameTokens.map((token) => textSimilarity(word, token))
    );

    if (bestToken >= 0.93) score += 0.18;
    else if (bestToken >= 0.85) score += 0.10;
    else if (bestToken >= 0.78) score += 0.04;
  }

  if (
    type === "Energy" &&
    /\b(energy|energia|energi|basica|basic)\b/.test(normalizedText)
  ) {
    score += 0.10;
  }

  if (
    type === "Trainer" &&
    /\b(trainer|treinador|stadium|estadio|supporter|apoiador|item|tool|ferramenta)\b/.test(
      normalizedText
    )
  ) {
    score += 0.10;
  }

  if (nameTokens.length >= 2) {
    const matchedTokens = nameTokens.filter((token) =>
      words.some((word) => textSimilarity(word, token) >= 0.90)
    );

    if (matchedTokens.length >= 2) {
      score += 0.20;
    }
  }

  return Math.min(1, score);
}

async function searchEnergyCards(
  text: string,
  cardNumber: string | null,
  energyHint?: string | null
): Promise<(GenericCardMatch & { candidates?: CardResult[]; ambiguous?: boolean }) | null> {
  const energyType = detectEnergyType(text, energyHint);

  if (!energyType) {
    console.log(
      "⚠️ Não foi possível determinar o tipo visual/textual da Energia."
    );
    return null;
  }

  const root = normalizeLoose(
    energyType.replace(/\s+energy$/i, "")
  );

  console.log("🌿 Tipo de Energia confirmado:", energyType);

  /*
   * IMPORTANTE:
   * Nunca aceitamos uma Energy diferente do tipo visual detectado.
   * Ex.: Grass Energy NÃO pode virar R Energy porque o OCR encontrou
   * uma palavra parecida ou um número isolado.
   */

  let cards: CardResult[] = [];

  const directedQueries = [
    `name:"${escapeQueryValue(root)}" supertype:Energy`,
    `name:${escapeQueryValue(root)} supertype:Energy`,
  ];

  for (const query of directedQueries) {
    const result = await searchCardsByQuery(query);

    if (result.success && result.cards.length) {
      cards.push(...result.cards);
      break;
    }
  }

  /* Fallback: carrega o conjunto geral apenas se a consulta direta falhar. */
  if (!cards.length) {
    const all = await getAllCardsBySupertype("Energy");
    cards = all.filter((card) =>
      normalizeLoose(card.name).includes(root)
    );
  }

  /* Remove duplicados. */
  const uniqueCards = [
    ...new Map(cards.map((card) => [card.id, card])).values(),
  ].filter((card) =>
    normalizeLoose(card.name).includes(root)
  );

  if (!uniqueCards.length) {
    console.log(
      "❌ Nenhuma impressão encontrada para:",
      energyType
    );
    return null;
  }

  /*
   * Número só tem valor quando veio de um padrão confiável.
   */
  if (cardNumber) {
    const exact = uniqueCards.find((card) =>
      cardNumberMatches(card, cardNumber)
    );

    if (exact) {
      console.log(
        "🎯 Energia confirmada por tipo + número:",
        exact.id
      );

      return {
        card: exact,
        confidence: 1,
        type: "Energy",
      };
    }
  }

  /*
   * Sem número/coleção, não escolhemos uma impressão arbitrária.
   * Em vez disso, retornamos null e evitamos preço errado.
   */
  console.log(
    `⚠️ ${energyType} identificada, mas existem ${uniqueCards.length} impressões possíveis. ` +
      "Sem número/coleção, vou deixar a página tentar a comparação visual."
  );

  const visualCandidates = uniqueCards.slice(0, 40);

  return {
    card: visualCandidates[0],
    confidence: 0,
    type: "Energy",
    candidates: visualCandidates,
    ambiguous: true,
  } as GenericCardMatch & { candidates: CardResult[]; ambiguous?: boolean };
}

async function searchGenericCards(
  text: string,
  cardNumber: string | null,
  energyHint?: string | null
): Promise<(GenericCardMatch & { candidates?: CardResult[]; ambiguous?: boolean }) | null> {
  const energy = isLikelyEnergyText(text);
  const trainer = isLikelyTrainerText(text);
  const detectedEnergy = detectEnergyType(text, energyHint);

  console.log("🧩 Reconhecimento direto da carta");
  console.log(
    "🧭 Tipo provável:",
    detectedEnergy
      ? detectedEnergy
      : energy
        ? "Energy"
        : trainer
          ? "Trainer"
          : "desconhecido"
  );

  if (energy || detectedEnergy) {
    return searchEnergyCards(
      text,
      cardNumber,
      energyHint
    );
  }

  /*
   * Se não há marcador de Trainer e também não há um Pokémon,
   * NÃO vamos vasculhar 250 cartas e adivinhar uma delas.
   * Isso foi a origem de falsos positivos como Bill's Maintenance.
   */
  if (!trainer) {
    console.log(
      "ℹ️ Sem marcador suficiente para classificar como Trainer."
    );
    return null;
  }

  const trainers = await getAllCardsBySupertype("Trainer");
  console.log(
    `📚 Trainer: ${trainers.length} cartas carregadas para comparação.`
  );

  const words = cleanOcrWords(text);
  const normalizedText = normalizeLoose(text);

  const candidates: GenericCardMatch[] = trainers
    .map((card) => {
      const cardName = normalizeLoose(card.name);
      const nameTokens = cardName
        .replace(/[\/-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);

      let score = 0;

      if (normalizedText.includes(cardName)) {
        score += 1.0;
      }

      if (cardNumber && cardNumberMatches(card, cardNumber)) {
        score += 0.80;
      }

      const matchedTokens = nameTokens.filter((token) =>
        words.some((word) => textSimilarity(word, token) >= 0.92)
      );

      if (matchedTokens.length === nameTokens.length && nameTokens.length > 1) {
        score += 0.35;
      } else if (matchedTokens.length >= 2) {
        score += 0.20;
      } else if (matchedTokens.length === 1 && nameTokens.length === 1) {
        score += 0.18;
      }

      return {
        card,
        confidence: Math.min(1, score),
        type: "Trainer" as const,
      };
    })
    .filter((item) => item.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence);

  if (!candidates.length) {
    console.log("❌ Nenhuma carta Trainer gerou evidência.");
    return null;
  }

  const best = candidates[0];
  const second = candidates[1];
  const margin = second
    ? best.confidence - second.confidence
    : best.confidence;

  console.log(
    "🏆 Melhor Trainer:",
    best.card.name,
    best.confidence.toFixed(3)
  );

  if (second) {
    console.log(
      "🥈 Segundo Trainer:",
      second.card.name,
      second.confidence.toFixed(3)
    );
  }

  if (
    (best.card.name && normalizedText.includes(normalizeLoose(best.card.name))) ||
    (best.confidence >= 0.92 && (!second || margin >= 0.08)) ||
    (cardNumber && cardNumberMatches(best.card, cardNumber))
  ) {
    console.log("✅ Trainer confirmado:", best.card.name);
    return best;
  }

  console.log("⚠️ Trainer continua ambíguo; enviando candidatas para comparação visual.");
  return {
    card: best.card,
    confidence: best.confidence,
    type: "Trainer",
    candidates: candidates.slice(0, 60).map((item) => item.card),
    ambiguous: true,
  } as GenericCardMatch & { candidates: CardResult[]; ambiguous?: boolean };
}

/* =========================================================
   TRAINER OVERRIDE

   Não fazemos mais uma consulta para cada palavra.
   Carregamos Trainer uma vez e comparamos localmente.
========================================================= */

async function tryTrainerOverrideForPokemonText(
  text: string,
  pokemon: PokemonRow,
  cardNumber: string | null
): Promise<GenericCardMatch | null> {
  const normalizedText = normalizeLoose(text);
  const words = cleanOcrWords(text);

  const pokemonTokens = normalizeLoose(pokemon.name)
    .replace(/[\/-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const extraWords = [
    ...new Set(
      words.filter(
        (word) =>
          word.length >= 4 &&
          !pokemonTokens.includes(word)
      )
    ),
  ];

  if (!extraWords.length) return null;

  console.log(
    "🛡️ Verificando possível Trainer antes de aceitar Pokémon:",
    pokemon.name,
    extraWords.slice(0, 8)
  );

  /*
   * PRIMEIRA TENTATIVA — a mais importante.
   * Se o OCR diz "Floette Ange" e existe um Trainer "Ange Floette",
   * uma query pelo próprio nome do Pokémon encontra o Trainer correto
   * sem depender das 250 primeiras cartas da coleção.
   */
  const direct = await searchCardsByQuery(
    `name:${escapeQueryValue(pokemon.name)} supertype:Trainer`
  );

  if (direct.success) {
    for (const card of direct.cards) {
      const tokens = normalizeLoose(card.name)
        .replace(/[\/-]+/g, " ")
        .split(/\s+/)
        .filter(Boolean);

      const hasPokemon = pokemonTokens.every((pokemonToken) =>
        tokens.some(
          (token) =>
            token === pokemonToken ||
            textSimilarity(token, pokemonToken) >= 0.94
        )
      );

      const hasExtra = extraWords.some((word) =>
        tokens.some(
          (token) =>
            token === word ||
            textSimilarity(token, word) >= 0.84
        )
      );

      if (!hasPokemon || !hasExtra) continue;

      console.log(
        "🎯 Trainer composto detectado por nome do Pokémon:",
        card.name
      );

      return {
        card,
        confidence: 0.99,
        type: "Trainer",
      };
    }
  }

  /*
   * SEGUNDA TENTATIVA — cache de Trainer já carregado.
   */
  const trainers = await getAllCardsBySupertype("Trainer");
  let best: GenericCardMatch | null = null;

  for (const card of trainers) {
    const cardName = normalizeLoose(card.name);
    const tokens = cardName
      .replace(/[\/-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean);

    const hasPokemon = pokemonTokens.every((pokemonToken) =>
      tokens.some(
        (token) =>
          token === pokemonToken ||
          textSimilarity(token, pokemonToken) >= 0.94
      )
    );

    if (!hasPokemon) continue;

    const extraMatches = extraWords.filter((word) =>
      tokens.some(
        (token) =>
          token === word ||
          textSimilarity(token, word) >= 0.84
      )
    );

    if (!extraMatches.length) continue;

    let confidence = 0.90;

    if (normalizedText.includes(cardName)) confidence += 0.08;
    if (cardNumber && cardNumberMatches(card, cardNumber)) confidence += 0.02;

    const candidate: GenericCardMatch = {
      card,
      confidence: Math.min(1, confidence),
      type: "Trainer",
    };

    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
    }
  }

  if (best && best.confidence >= 0.90) {
    console.log(
      "🎯 Trainer composto encontrado no cache:",
      best.card.name
    );
    return best;
  }

  /*
   * TERCEIRA TENTATIVA — usa apenas a palavra extra mais provável.
   * Evitamos chamadas por todo o lixo do OCR.
   */
  const sortedExtra = [...extraWords].sort((a, b) => b.length - a.length);
  const bestWord = sortedExtra.find((word) => word.length >= 4);

  if (bestWord) {
    const result = await searchCardsByQuery(
      `name:${escapeQueryValue(bestWord)} supertype:Trainer`
    );

    if (result.success) {
      for (const card of result.cards) {
        const tokens = normalizeLoose(card.name)
          .replace(/[\/-]+/g, " ")
          .split(/\s+/)
          .filter(Boolean);

        const hasPokemon = pokemonTokens.every((pokemonToken) =>
          tokens.some(
            (token) =>
              token === pokemonToken ||
              textSimilarity(token, pokemonToken) >= 0.94
          )
        );

        if (hasPokemon) {
          console.log(
            "🎯 Trainer composto encontrado por palavra extra:",
            card.name
          );

          return {
            card,
            confidence: 0.97,
            type: "Trainer",
          };
        }
      }
    }
  }

  return null;
}

/* =========================================================
   PREÇO
========================================================= */

function getMarketPrice(card: CardResult) {
  const prices = card.tcgplayer?.prices;

  if (!prices) return undefined;

  const versions = [
    "holofoil",
    "normal",
    "reverseHolofoil",
    "1stEditionHolofoil",
    "1stEditionNormal",
    "unlimitedHolofoil",
  ];

  for (const version of versions) {
    const entry = prices[version];

    if (typeof entry?.market === "number") return entry.market;
  }

  for (const version of Object.keys(prices)) {
    const entry = prices[version];

    if (typeof entry?.market === "number") return entry.market;
  }

  return undefined;
}

async function getExchangeRates() {
  try {
    const response = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=BRL,EUR",
      { cache: "no-store" }
    );

    if (!response.ok) return null;

    const data = await response.json();

    return {
      brl: Number(data.rates?.BRL) || null,
      eur: Number(data.rates?.EUR) || null,
    };
  } catch {
    return null;
  }
}


function withCardImageUrls(card: CardResult): CardResult {
  const setId = card.set?.id?.trim();
  const number = String(card.number ?? '').trim();

  if (!setId || !number) {
    return card;
  }

  const base = `https://images.pokemontcg.io/${encodeURIComponent(setId)}/${encodeURIComponent(number)}`;

  const small = card.images?.small || `${base}.png`;
  const large = card.images?.large || `${base}_hires.png`;

  return {
    ...card,
    imageUrl: large || small,
    images: {
      small,
      large,
    },
  };
}

/* =========================================================
   RESULTADO
========================================================= */

async function buildRecognizedCardResult(
  text: string,
  card: CardResult,
  pokemon: PokemonRow | null,
  genericType?: "Trainer" | "Energy"
) {
  card = withCardImageUrls(card);

  const usd = getMarketPrice(card);

  let brl: number | undefined;
  let eur: number | undefined;

  if (typeof usd === "number") {
    const rates = await getExchangeRates();

    if (rates?.brl) brl = usd * rates.brl;
    if (rates?.eur) eur = usd * rates.eur;
  }

  const cardType =
    card.supertype || genericType || "Pokémon";

  console.log("💰 Preço USD:", usd);
  console.log("💰 Preço BRL:", brl);
  console.log("💰 Preço EUR:", eur);

  console.log("=================================");
  console.log("✅ CARTA IDENTIFICADA");
  console.log("=================================");
  console.log("Carta:", card.name);
  console.log("Tipo:", cardType);
  console.log("Número:", card.number);
  console.log("Coleção:", card.set?.name);

  return {
    success: true,
    recognized: true,
    text,

    card: {
      id: card.id,
      name: card.name,
      number: card.number,
      imageUrl: card.imageUrl || card.images?.large || card.images?.small,
      supertype: card.supertype,
      subtypes: card.subtypes,
      rarity: card.rarity,
      nationalPokedexNumbers:
        card.nationalPokedexNumbers ||
        (pokemon ? [pokemon.national_dex_number] : []),
      set: card.set,
      images: card.images,
      tcgplayer: card.tcgplayer,
    },

    pokemon: pokemon
      ? {
          id: pokemon.id,
          nationalDexNumber: pokemon.national_dex_number,
          name: pokemon.name,
          image: pokemon.image,
          type1: pokemon.type1,
          type2: pokemon.type2,
          generation: pokemon.generation,
        }
      : null,

    cardType,

    prices: {
      usd,
      brl,
      eur,
    },
  };
}

/* =========================================================
   RECONHECIMENTO PRINCIPAL
========================================================= */

type RecognitionOptions = {
  energyHint?: string | null;
  image?: string | null;
  headerText?: string | null;
  bottomText?: string | null;
};

async function recognizeCard(
  text: string,
  options: RecognitionOptions = {}
) {
  console.log("=================================");
  console.log("🔎 POKÉSCAN - RECONHECIMENTO");
  console.log("=================================");
  console.log("Texto recebido do navegador:");
  console.log(text);

  const headerText = options.headerText ?? "";
  const bottomText = options.bottomText ?? "";
  const analysisText = [text, headerText, bottomText]
    .filter(Boolean)
    .join('\n');

  // Só aceitamos números vindos de padrões explícitos (ex.: 30/106, #30, 30-106).
  // Um número isolado no rodapé costuma ser HP/dano e não deve escolher a impressão.
  const cardNumber =
    getCardNumber(bottomText) ||
    getCardNumber(text);
  const explicitEnergy = isLikelyEnergyText(analysisText);
  const explicitTrainer = isLikelyTrainerText(analysisText);
  const energyHint = options.energyHint ?? null;

  if (energyHint) {
    console.log("🌿 Dica visual de energia recebida:", energyHint);
  }

  console.log("🔢 Número encontrado:", cardNumber);
  console.log(
    "🧭 Marcadores de carta:",
    explicitEnergy ? "ENERGY" : explicitTrainer ? "TRAINER" : "POKEMON/UNKNOWN"
  );

  /* =======================================================
     PRÉ-RECONHECIMENTO DO CABEÇALHO

     O nome da carta fica no topo. Em Trainer composto, como
     "Floette Ange", o OCR do corpo pode ser ruim, então usamos
     o cabeçalho antes de classificar pela espécie Pokémon.
  ======================================================= */

  if (headerText.trim()) {
    const headerWords = cleanOcrWords(normalizeOcrAliases(headerText));
    const phrases = new Set<string>();

    for (let size = 2; size <= Math.min(3, headerWords.length); size++) {
      for (let i = 0; i <= headerWords.length - size; i++) {
        const phrase = headerWords.slice(i, i + size).join(' ');
        if (phrase.length >= 5) phrases.add(phrase);

        if (size === 2) {
          const reversed = headerWords.slice(i, i + size).reverse().join(' ');
          if (reversed.length >= 5) phrases.add(reversed);
        }
      }
    }

    for (const phrase of phrases) {
      const phraseLooksTrainerLike =
        /\b(trainer|treinador|supporter|apoiador|stadium|estadio|item|tool|ferramenta)\b/i.test(headerText) ||
        /\b(floette|gardevoir|pikachu|charizard|ange)\b/i.test(phrase);

      if (!phraseLooksTrainerLike) continue;

      const trainerResult = await searchCardsByQuery(
        `name:"${escapeQueryValue(phrase)}" supertype:Trainer`
      );

      if (trainerResult.success && trainerResult.cards.length) {
        const card = trainerResult.cards.find((candidate) => {
          const candidateName = normalizeLoose(candidate.name);
          return phrase
            .split(/\s+/)
            .every((word) => candidateName.includes(word));
        });

        if (card) {
          console.log('🎯 Trainer confirmado pelo cabeçalho:', card.name);
          return buildRecognizedCardResult(text, card, null, 'Trainer');
        }
      }
    }

    const headerPokemon = findPokemonFromText(headerText);
    if (headerPokemon) {
      const trainerFromHeader = await tryTrainerOverrideForPokemonText(
        headerText,
        headerPokemon,
        cardNumber
      );

      if (trainerFromHeader) {
        return buildRecognizedCardResult(
          text,
          trainerFromHeader.card,
          null,
          'Trainer'
        );
      }
    }
  }

  /* =======================================================
     FLUXO ENERGY / TRAINER EXPLÍCITO
  ======================================================= */

  if (explicitEnergy || explicitTrainer) {
    const generic = await searchGenericCards(
      analysisText,
      cardNumber,
      energyHint
    );

    if (generic) {
      if (generic.ambiguous && generic.candidates?.length) {
        return {
          success: true,
          recognized: false,
          cardResolved: false,
          text,
          cardType: generic.type,
          candidates: generic.candidates,
          candidateType: generic.type,
          message: "Categoria da carta identificada. Vou comparar a imagem com as impressões encontradas antes de concluir.",
        };
      }

      return buildRecognizedCardResult(
        text,
        generic.card,
        null,
        generic.type
      );
    }
  }

  /* =======================================================
     IDENTIFICAR ESPÉCIE POKÉMON
  ======================================================= */

  const pokemon =
    findPokemonFromText(headerText) ||
    findPokemonFromText(text) ||
    findPokemonFromText(analysisText);

  if (pokemon) {
    /*
     * Antes de aceitar a espécie, verificamos Trainer composto.
     * Ex.: Floette Ange -> Ange Floette.
     */
    const headerLooksTrainer =
      explicitTrainer ||
      /\b(trainer|treinador|supporter|apoiador|stadium|estadio|item|tool|ferramenta)\b/i.test(
        analysisText
      );

    const trainerOverride = headerLooksTrainer
      ? await tryTrainerOverrideForPokemonText(
          headerText || analysisText,
          pokemon,
          cardNumber
        )
      : null;

    if (trainerOverride) {
      return buildRecognizedCardResult(
        text,
        trainerOverride.card,
        null,
        "Trainer"
      );
    }

    console.log("🔎 Pokémon encontrado:", pokemon.name);

    const candidates =
      await searchPokemonCardCandidates(
        pokemon,
        analysisText,
        cardNumber
      );

    const selectedCard = choosePokemonCard(
      candidates,
      cardNumber
    );

    if (!selectedCard) {
      console.log(
        "❌ Pokémon identificado, mas a API não retornou nenhuma carta para essa espécie."
      );

      return {
        success: true,
        recognized: false,
        cardResolved: false,
        text,
        detectedName: pokemon.name,
        cardNumber,
        pokemon: {
          id: pokemon.id,
          nationalDexNumber: pokemon.national_dex_number,
          name: pokemon.name,
          image: pokemon.image,
          type1: pokemon.type1,
          type2: pokemon.type2,
          generation: pokemon.generation,
        },
        candidateType: "Pokémon",
        message:
          `Reconheci ${pokemon.name}, mas a base de cartas não retornou uma impressão disponível agora.`,
      };
    }

    const result = await buildRecognizedCardResult(
      text,
      selectedCard,
      pokemon
    );

    return {
      ...result,
      // true = Pokémon identificado; false = impressão da foto não confirmada.
      cardResolved: Boolean(
        cardNumber && cardNumberMatches(selectedCard, cardNumber)
      ),
      message:
        cardNumber && cardNumberMatches(selectedCard, cardNumber)
          ? `Pokémon ${pokemon.name} identificado e impressão confirmada pelo número ${cardNumber}.`
          : `Pokémon ${pokemon.name} identificado. A imagem exibida é uma impressão de referência; a impressão exata da foto não foi confirmada.`,
    };
  }

  /* =======================================================
     FLUXO GENÉRICO — TRAINER / ENERGY
  ======================================================= */

  console.log(
    "ℹ️ Nenhum Pokémon encontrado. Mudando para reconhecimento direto da carta."
  );

  /* Tentativa final de Trainer baseada somente no cabeçalho. */
  if (headerText.trim()) {
    const headerWords = cleanOcrWords(normalizeOcrAliases(headerText));
    const phrase = headerWords.slice(0, 4).join(" ");
    const reverse = headerWords.length >= 2
      ? [...headerWords.slice(0, 2)].reverse().join(" ")
      : "";

    for (const candidatePhrase of [phrase, reverse]) {
      if (!candidatePhrase || candidatePhrase.length < 5) continue;

      const trainerResult = await searchCardsByQuery(
        `name:"${escapeQueryValue(candidatePhrase)}" supertype:Trainer`
      );

      if (trainerResult.success && trainerResult.cards.length) {
        const exact = trainerResult.cards.find((card) => {
          const normalizedName = normalizeLoose(card.name);
          return candidatePhrase
            .split(/\s+/)
            .every((word) => normalizedName.includes(word));
        });

        if (exact) {
          console.log("🎯 Trainer confirmado pelo cabeçalho:", exact.name);
          return buildRecognizedCardResult(text, exact, null, "Trainer");
        }
      }
    }
  }

  const generic = await searchGenericCards(
    analysisText,
    cardNumber,
    energyHint
  );

  if (!generic) {
    console.log("=================================");
    console.log("⚠️ CARTA NÃO IDENTIFICADA");
    console.log("=================================");

    return {
      success: true,
      recognized: false,
      text,
      cardNumber,
      message:
        "Não consegui identificar a impressão da carta com segurança. Tente aproximar, reduzir o brilho e manter a carta inteira dentro da câmera.",
    };
  }

  return buildRecognizedCardResult(
    text,
    generic.card,
    null,
    generic.type
  );
}

/* =========================================================
   POKÉDEX
========================================================= */

async function registerPokemon(pokemonId: number) {
  const db = getDatabase();

  try {
    const pokemon = db
      .prepare(`
        SELECT
          id,
          national_dex_number,
          name,
          image,
          type1,
          type2,
          generation
        FROM pokemon
        WHERE id = ?
      `)
      .get(pokemonId) as PokemonRow | undefined;

    if (!pokemon) {
      return NextResponse.json(
        {
          success: false,
          error: "Pokémon não encontrado.",
        },
        { status: 404 }
      );
    }

    const existing = db
      .prepare(`
        SELECT id
        FROM pokedex
        WHERE pokemon_id = ?
      `)
      .get(pokemonId);

    if (existing) {
      return NextResponse.json({
        success: true,
        alreadyRegistered: true,
        registered: true,
        pokemon,
        message:
          "Esse Pokémon já está registrado na sua Pokédex.",
      });
    }

    db.prepare(`
      INSERT INTO pokedex
        (pokemon_id, registered_at)
      VALUES
        (?, ?)
    `).run(
      pokemonId,
      new Date().toISOString()
    );

    return NextResponse.json({
      success: true,
      registered: true,
      alreadyRegistered: false,
      pokemon,
      message: "Pokémon registrado na sua Pokédex!",
    });
  } finally {
    db.close();
  }
}

/* =========================================================
   POST
========================================================= */

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (body.action === "resolve-card") {
      const cardId = typeof body.cardId === "string" ? body.cardId.trim() : "";
      const pokemonId = Number(body.pokemonId);
      const cardType = typeof body.cardType === "string" ? body.cardType : "Pokémon";

      if (!cardId) {
        return NextResponse.json(
          { success: false, error: "cardId inválido." },
          { status: 400 }
        );
      }

      const result = await searchCardsByQuery(`id:${escapeQueryValue(cardId)}`);
      const card = result.cards.find((item) => item.id === cardId);

      if (!card) {
        return NextResponse.json(
          { success: false, error: "Carta candidata não encontrada." },
          { status: 404 }
        );
      }

      let pokemon: PokemonRow | null = null;
      if (Number.isInteger(pokemonId)) {
        const db = getDatabase();
        try {
          pokemon = db.prepare(`
            SELECT id, national_dex_number, name, image, type1, type2, generation
            FROM pokemon WHERE id = ?
          `).get(pokemonId) as PokemonRow | undefined ?? null;
        } finally {
          db.close();
        }
      }

      const resolved = await buildRecognizedCardResult(
        typeof body.text === "string" ? body.text : "",
        card,
        pokemon,
        cardType === "Trainer" || cardType === "Energy" ? cardType : undefined
      );

      return NextResponse.json(resolved);
    }

    if (body.action === "register") {
      const pokemonId = Number(body.pokemonId);

      if (!Number.isInteger(pokemonId)) {
        return NextResponse.json(
          {
            success: false,
            error: "pokemonId inválido.",
          },
          { status: 400 }
        );
      }

      return registerPokemon(pokemonId);
    }

    const text =
      typeof body.text === "string"
        ? body.text.trim()
        : "";

    const energyHint =
      typeof body.energyHint === "string"
        ? body.energyHint
        : null;

    const image =
      typeof body.image === "string"
        ? body.image
        : null;

    const headerText =
      typeof body.headerText === "string"
        ? body.headerText
        : null;

    const bottomText =
      typeof body.bottomText === "string"
        ? body.bottomText
        : null;

    if (!text) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Nenhum texto foi enviado para reconhecimento.",
        },
        { status: 400 }
      );
    }

    if (image) {
      console.log(
        "🖼️ Imagem da captura recebida para análise complementar:",
        Math.round(image.length / 1024),
        "KB"
      );
    }

    const result = await recognizeCard(text, {
      energyHint,
      image,
      headerText,
      bottomText,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("❌ Erro no scanner:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro interno no reconhecimento.",
      },
      { status: 500 }
    );
  }
}
