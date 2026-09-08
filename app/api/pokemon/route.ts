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
  rarity?: string;

  nationalPokedexNumbers?: number[];

  set?: {
    id?: string;
    name?: string;
    series?: string;
    releaseDate?: string;
    printedTotal?: number;
    total?: number;
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

/* =========================================================
   BANCO DE DADOS
========================================================= */

function getDatabase() {
  return new DatabaseSync("pokescan.sqlite");
}

/* =========================================================
   NORMALIZAÇÃO DE TEXTO
========================================================= */

function normalize(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   LIMPEZA DO OCR
========================================================= */

function cleanOcrText(text: string) {
  return text
    .replace(/\r/g, "\n")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   NÚMERO DA CARTA
========================================================= */

function getCardNumber(text: string) {
  const patterns = [
    /(\d{1,3})\s*\/\s*(\d{1,3})/,
    /(\d{1,3})\s*-\s*(\d{1,3})/,
    /(?:no|nº|n°|number|num|#)\s*(\d{1,3})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

/* =========================================================
   COMPARAÇÃO DE NÚMEROS
========================================================= */

function normalizeCardNumber(value: string | number) {
  return String(value)
    .trim()
    .replace(/^0+/, "");
}

function sameCardNumber(
  a: string | number,
  b: string | number
) {
  return (
    normalizeCardNumber(a) ===
    normalizeCardNumber(b)
  );
}

/* =========================================================
   LOCALIZA POKÉMON NA BASE SQLITE
========================================================= */

function findPokemonFromText(
  text: string
): PokemonRow | null {
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

    const normalizedText = normalize(text);

    let bestMatch: PokemonRow | null = null;

    let bestScore = 0;

    for (const candidate of pokemon) {
      const candidateName =
        normalize(candidate.name);

      if (!candidateName) {
        continue;
      }

      /*
       * Procuramos o nome como palavra.
       *
       * Isso evita, por exemplo, que um nome
       * pequeno seja encontrado dentro de outra palavra.
       */
      const namePattern = new RegExp(
        `(^|\\s)${candidateName.replace(
          /[-/\\^$*+?.()|[\]{}]/g,
          "\\$&"
        )}(?=\\s|$)`,
        "i"
      );

      if (namePattern.test(normalizedText)) {
        const score =
          candidateName.length + 1000;

        if (score > bestScore) {
          bestMatch = candidate;
          bestScore = score;
        }

        continue;
      }

      /*
       * Segunda tentativa:
       * procura simplesmente dentro do texto.
       *
       * É útil quando o OCR junta palavras.
       */
      if (
        candidateName.length >= 4 &&
        normalizedText.includes(candidateName)
      ) {
        const score =
          candidateName.length;

        if (score > bestScore) {
          bestMatch = candidate;
          bestScore = score;
        }
      }
    }

    return bestMatch;
  } finally {
    db.close();
  }
}

/* =========================================================
   CONSULTA POKÉMON TCG API
========================================================= */

async function searchCard(
  pokemonName: string,
  cardNumber: string | null
) {
  const url = new URL(
    "https://api.pokemontcg.io/v2/cards"
  );

  /*
   * Primeiro procuramos pelo nome.
   *
   * Depois, se tivermos o número, também
   * usamos o número para reduzir os resultados.
   */
  let query =
    `name:"${pokemonName.replace(/"/g, '\\"')}"`;

  if (cardNumber) {
    query +=
      ` number:"${cardNumber.replace(
        /"/g,
        '\\"'
      )}"`;
  }

  url.searchParams.set("q", query);
  url.searchParams.set("page", "1");
  url.searchParams.set("pageSize", "50");

  const headers: HeadersInit = {};

  if (process.env.POKEMON_TCG_API_KEY) {
    headers["X-Api-Key"] =
      process.env.POKEMON_TCG_API_KEY;
  }

  const response = await fetch(
    url.toString(),
    {
      headers,
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error(
      `Pokémon TCG API respondeu ${response.status}.`
    );
  }

  const data =
    await response.json();

  return (data.data || []) as CardResult[];
}

/* =========================================================
   ESCOLHE A CARTA CORRETA
========================================================= */

function chooseBestCard(
  cards: CardResult[],
  cardNumber: string | null
) {
  if (!cards.length) {
    return null;
  }

  /*
   * Se conseguimos o número pelo OCR,
   * tentamos encontrar exatamente aquela impressão.
   */
  if (cardNumber) {
    const exact = cards.find((card) =>
      sameCardNumber(
        card.number,
        cardNumber
      )
    );

    if (exact) {
      return exact;
    }
  }

  /*
   * Caso não tenhamos o número ou não exista
   * correspondência exata, usamos a primeira
   * carta retornada pela API.
   */
  return cards[0];
}

/* =========================================================
   PREÇO DE MERCADO
========================================================= */

function getMarketPrice(
  card: CardResult
) {
  const prices =
    card.tcgplayer?.prices;

  if (!prices) {
    return undefined;
  }

  const versions = [
    "holofoil",
    "normal",
    "reverseHolofoil",
    "1stEditionHolofoil",
    "1stEditionNormal",
  ];

  for (const version of versions) {
    const market =
      prices[version]?.market;

    if (
      typeof market === "number"
    ) {
      return market;
    }
  }

  /*
   * Caso não exista market,
   * tentamos o mid.
   */
  for (const version of versions) {
    const mid =
      prices[version]?.mid;

    if (
      typeof mid === "number"
    ) {
      return mid;
    }
  }

  return undefined;
}

/* =========================================================
   CÂMBIO
========================================================= */

async function getExchangeRates() {
  try {
    const response = await fetch(
      "https://api.frankfurter.app/latest?from=USD&to=BRL,EUR",
      {
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    return {
      brl:
        Number(data.rates?.BRL) ||
        null,

      eur:
        Number(data.rates?.EUR) ||
        null,
    };
  } catch (error) {
    console.warn(
      "Não foi possível consultar câmbio:",
      error
    );

    return null;
  }
}

/* =========================================================
   RECONHECIMENTO
========================================================= */

async function recognizeCard(
  originalText: string
) {
  const text =
    cleanOcrText(originalText);

  const pokemon =
    findPokemonFromText(text);

  /*
   * Pokémon não encontrado.
   */
  if (!pokemon) {
    return {
      success: true,
      recognized: false,

      text,

      message:
        "Não consegui identificar o Pokémon no texto da carta.",
    };
  }

  const cardNumber =
    getCardNumber(text);

  console.log(
    "🔎 Pokémon encontrado:",
    pokemon.name
  );

  console.log(
    "🔢 Número encontrado:",
    cardNumber ?? "não encontrado"
  );

  /*
   * Primeira busca:
   * nome + número.
   */
  let cards =
    await searchCard(
      pokemon.name,
      cardNumber
    );

  /*
   * Se não encontrou, fazemos uma busca
   * somente pelo nome.
   */
  if (!cards.length) {
    console.log(
      "⚠️ Busca com número não encontrou carta."
    );

    cards =
      await searchCard(
        pokemon.name,
        null
      );
  }

  /*
   * Pokémon encontrado, mas carta não.
   */
  if (!cards.length) {
    return {
      success: true,
      recognized: false,

      text,

      detectedName:
        pokemon.name,

      cardNumber,

      pokemon: {
        id: pokemon.id,

        nationalDexNumber:
          pokemon.national_dex_number,

        name: pokemon.name,

        image:
          pokemon.image,

        type1:
          pokemon.type1,

        type2:
          pokemon.type2,

        generation:
          pokemon.generation,
      },

      message:
        "Encontrei o Pokémon, mas não encontrei a carta correspondente na base de cartas.",
    };
  }

  const card =
    chooseBestCard(
      cards,
      cardNumber
    );

  if (!card) {
    return {
      success: true,
      recognized: false,
      text,

      message:
        "Não foi possível selecionar uma carta.",
    };
  }

  console.log(
    "🃏 Carta encontrada:",
    card.name
  );

  console.log(
    "🆔 ID da carta:",
    card.id
  );

  console.log(
    "🔢 Número da carta:",
    card.number
  );

  console.log(
    "📚 Coleção:",
    card.set?.name ??
      "não informada"
  );

  /*
   * Preço.
   */
  const usd =
    getMarketPrice(card);

  let brl:
    | number
    | undefined;

  let eur:
    | number
    | undefined;

  if (
    typeof usd === "number"
  ) {
    const rates =
      await getExchangeRates();

    if (rates?.brl) {
      brl =
        usd * rates.brl;
    }

    if (rates?.eur) {
      eur =
        usd * rates.eur;
    }
  }

  /*
   * Resultado final.
   */
  return {
    success: true,

    recognized: true,

    text,

    card: {
      id: card.id,

      name: card.name,

      number: card.number,

      rarity:
        card.rarity,

      nationalPokedexNumbers:
        card.nationalPokedexNumbers ||
        [pokemon.national_dex_number],

      set: card.set,

      images: card.images,

      tcgplayer:
        card.tcgplayer
          ? {
              updatedAt:
                card.tcgplayer
                  .updatedAt,
            }
          : undefined,
    },

    pokemon: {
      id: pokemon.id,

      nationalDexNumber:
        pokemon.national_dex_number,

      name: pokemon.name,

      image:
        pokemon.image,

      type1:
        pokemon.type1,

      type2:
        pokemon.type2,

      generation:
        pokemon.generation,
    },

    prices: {
      usd,

      brl,

      eur,
    },

    /*
     * Informação útil para a próxima etapa
     * da Pokédex.
     */
    collection: {
      cardId: card.id,

      cardNumber:
        card.number,

      setId:
        card.set?.id ??
        null,

      setName:
        card.set?.name ??
        null,

      setSeries:
        card.set?.series ??
        null,
    },

    message:
      "Carta identificada com sucesso!",
  };
}

/* =========================================================
   REGISTRO ATUAL DA POKÉDEX
   =========================================================

   IMPORTANTE:
   Por enquanto mantemos o sistema atual.

   No próximo passo vamos mudar para:

   pokemon_id + card_id

   para permitir várias cartas do mesmo Pokémon.
========================================================= */

async function registerPokemon(
  pokemonId: number
) {
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
      .get(pokemonId) as
      | PokemonRow
      | undefined;

    if (!pokemon) {
      return NextResponse.json(
        {
          success: false,

          error:
            "Pokémon não encontrado.",
        },
        {
          status: 404,
        }
      );
    }

    const existing =
      db
        .prepare(`
          SELECT id
          FROM pokedex
          WHERE pokemon_id = ?
        `)
        .get(pokemonId);

    if (existing) {
      return NextResponse.json({
        success: true,

        alreadyRegistered:
          true,

        registered:
          true,

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

      registered:
        true,

      alreadyRegistered:
        false,

      pokemon,

      message:
        "Pokémon registrado na sua Pokédex!",
    });
  } finally {
    db.close();
  }
}

/* =========================================================
   POST
========================================================= */

export async function POST(
  request: Request
) {
  try {
    const body =
      await request.json();

    /*
     * ============================================
     * REGISTRAR POKÉMON
     * ============================================
     */

    if (
      body.action ===
      "register"
    ) {
      const pokemonId =
        Number(
          body.pokemonId
        );

      if (
        !Number.isInteger(
          pokemonId
        )
      ) {
        return NextResponse.json(
          {
            success: false,

            error:
              "pokemonId inválido.",
          },
          {
            status: 400,
          }
        );
      }

      return registerPokemon(
        pokemonId
      );
    }

    /*
     * ============================================
     * RECONHECER CARTA
     * ============================================
     */

    const text =
      typeof body.text ===
      "string"
        ? body.text.trim()
        : "";

    if (!text) {
      return NextResponse.json(
        {
          success: false,

          error:
            "Nenhum texto foi enviado para reconhecimento.",
        },
        {
          status: 400,
        }
      );
    }

    console.log(
      "================================="
    );

    console.log(
      "🔎 POKÉSCAN - RECONHECIMENTO"
    );

    console.log(
      "================================="
    );

    console.log(
      "Texto recebido do navegador:"
    );

    console.log(text);

    const result =
      await recognizeCard(
        text
      );

    console.log(
      "================================="
    );

    console.log(
      result.recognized
        ? "✅ CARTA IDENTIFICADA"
        : "⚠️ CARTA NÃO IDENTIFICADA"
    );

    console.log(
      "================================="
    );

    return NextResponse.json(
      result
    );
  } catch (error) {
    console.error(
      "❌ Erro no scanner:",
      error
    );

    return NextResponse.json(
      {
        success: false,

        error:
          error instanceof Error
            ? error.message
            : "Erro interno no reconhecimento.",
      },
      {
        status: 500,
      }
    );
  }
}