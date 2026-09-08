import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";

export const runtime = "nodejs";

/* =========================================================
   TIPOS
========================================================= */

type CardPrice = {
  low?: number | null;
  mid?: number | null;
  high?: number | null;
  market?: number | null;
  directLow?: number | null;
};

type TcgCard = {
  id: string;
  name: string;

  supertype?: string | null;
  subtypes?: string[] | null;

  number?: string | null;
  rarity?: string | null;

  nationalPokedexNumbers?: number[] | null;

  set?: {
    id?: string | null;
    name?: string | null;
    series?: string | null;
    releaseDate?: string | null;
    printedTotal?: number | null;
    total?: number | null;
  } | null;

  images?: {
    small?: string | null;
    large?: string | null;
  } | null;

  tcgplayer?: {
    url?: string | null;
    updatedAt?: string | null;
    prices?: Record<
      string,
      CardPrice
    > | null;
  } | null;

  cardmarket?: {
    url?: string | null;
    updatedAt?: string | null;
  } | null;
};

type PokemonRow = {
  id: number;
  national_dex_number: number;
  name: string;
  image: string | null;
  type1: string | null;
  type2: string | null;
  generation: number | null;
};

type ExchangeRates = {
  brl: number | null;
  eur: number | null;
};

type SourceType =
  | "api"
  | "cache"
  | "cache+price-refresh"
  | "none";

type ManualPriceOverride = {
  cardId: string;
  usd: number | null;
  brl: number | null;
  source: string | null;
  note: string | null;
  updatedAt: string;
};

type OwnedCardRecord = {
  cardId: string;
  cardName: string;
  setId: string | null;
  setName: string | null;
  cardNumber: string | null;
  image: string | null;
  addedAt: string;
  quantity: number;
};

type AutoRegisteredPokemon = {
  id: number;
  pokemonId: number;
  name: string;
  nationalDexNumber: number;
  image: string | null;
  type1: string | null;
  type2: string | null;
  generation: number | null;
};

type SetOwnedResult = {
  owned: boolean;
  quantity: number;
  autoRegisteredPokemon:
    | AutoRegisteredPokemon
    | null;
  alreadyRegistered: boolean;
};

type CollectionCategory =
  | "pokemon"
  | "trainer"
  | "energy"
  | "stadium";

type CollectionSummaryItem = {
  models: number;
  quantity: number;
};

type PriceHistoryPoint = {
  id: number;
  usd: number | null;
  brl: number | null;
  source: string | null;
  capturedAt: string;
};

type PokemonRegistrationSource =
  | "manual"
  | "card";

/* =========================================================
   CONFIGURAÇÃO
========================================================= */

const POKEMON_TCG_API_URL =
  "https://api.pokemontcg.io/v2/cards";

const REQUEST_TIMEOUT_MS = 5500;
const PRICE_REFRESH_TIMEOUT_MS = 4500;
const MAX_RETRIES = 3;

const EXCHANGE_CACHE_MS =
  15 * 60 * 1000;

let exchangeCache:
  | {
      value: ExchangeRates;
      expiresAt: number;
    }
  | null = null;

/* =========================================================
   DATABASE
========================================================= */

function getDatabase() {
  return new DatabaseSync(
    process.env.DB_FILE_NAME ||
      "./pokescan.sqlite"
  );
}

/* =========================================================
   TABELAS AUXILIARES
========================================================= */

function ensureAuxiliaryTables(
  db: DatabaseSync
) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_cache (
      card_id TEXT PRIMARY KEY,
      pokemon_name TEXT NOT NULL,
      card_json TEXT NOT NULL,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_price_cache (
      card_id TEXT PRIMARY KEY,
      usd REAL,
      source TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_price_override (
      card_id TEXT PRIMARY KEY,
      usd REAL,
      brl REAL,
      source TEXT,
      note TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      usd REAL,
      brl REAL,
      source TEXT,
      captured_at TEXT
    );

    CREATE TABLE IF NOT EXISTS exchange_rate_cache (
      base_currency TEXT NOT NULL,
      target_currency TEXT NOT NULL,
      rate REAL NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (
        base_currency,
        target_currency
      )
    );

    CREATE TABLE IF NOT EXISTS owned_cards (
      card_id TEXT PRIMARY KEY,
      card_name TEXT NOT NULL,
      set_id TEXT,
      set_name TEXT,
      card_number TEXT,
      image TEXT,
      added_at TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1
    );
  `);

  /* =======================================================
     HELPERS DE MIGRAÇÃO
  ======================================================= */

  function getColumns(
    tableName: string
  ) {
    return db
      .prepare(
        `PRAGMA table_info(${tableName})`
      )
      .all() as Array<{
        name?: string;
      }>;
  }

  function hasColumn(
    tableName: string,
    columnName: string
  ) {
    return getColumns(
      tableName
    ).some(
      (column) =>
        column.name ===
        columnName
    );
  }

  /* =======================================================
     MIGRAÇÃO - CARD PRICE OVERRIDE
  ======================================================= */

  try {
    if (
      !hasColumn(
        "card_price_override",
        "brl"
      )
    ) {
      db.exec(
        `ALTER TABLE card_price_override ADD COLUMN brl REAL`
      );

      console.log(
        "🆕 Coluna BRL adicionada à tabela card_price_override."
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Não foi possível migrar card_price_override:",
      error
    );
  }

  /* =======================================================
     MIGRAÇÃO - OWNED CARDS / QUANTIDADE
  ======================================================= */

  try {
    if (
      !hasColumn(
        "owned_cards",
        "quantity"
      )
    ) {
      db.exec(`
        ALTER TABLE owned_cards
        ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1
      `);

      console.log(
        "🆕 Coluna quantity adicionada à tabela owned_cards."
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Não foi possível migrar quantity em owned_cards:",
      error
    );
  }

  /* =======================================================
     MIGRAÇÃO - HISTÓRICO DE PREÇOS
  ======================================================= */

  try {
    const hasCapturedAt =
      hasColumn(
        "card_price_history",
        "captured_at"
      );

    const hasRecordedAt =
      hasColumn(
        "card_price_history",
        "recorded_at"
      );

    if (!hasCapturedAt) {
      const fallbackTimestamp =
        new Date().toISOString();

      db.exec(`
        ALTER TABLE card_price_history
        ADD COLUMN captured_at TEXT NOT NULL
        DEFAULT '${fallbackTimestamp.replace(/'/g, "''")}'
      `);

      console.log(
        "🆕 Coluna captured_at adicionada ao histórico de preços."
      );

      if (hasRecordedAt) {
        db.exec(`
          UPDATE card_price_history
          SET captured_at = recorded_at
          WHERE recorded_at IS NOT NULL
            AND TRIM(recorded_at) <> ''
        `);

        console.log(
          "♻️ Histórico legado recorded_at convertido para captured_at."
        );
      }
    }

    if (
      !hasColumn(
        "card_price_history",
        "brl"
      )
    ) {
      db.exec(
        `ALTER TABLE card_price_history ADD COLUMN brl REAL`
      );

      console.log(
        "🆕 Coluna brl adicionada ao histórico de preços."
      );
    }

    if (
      !hasColumn(
        "card_price_history",
        "source"
      )
    ) {
      db.exec(
        `ALTER TABLE card_price_history ADD COLUMN source TEXT`
      );

      console.log(
        "🆕 Coluna source adicionada ao histórico de preços."
      );
    }

    if (
      !hasColumn(
        "card_price_history",
        "usd"
      )
    ) {
      db.exec(
        `ALTER TABLE card_price_history ADD COLUMN usd REAL`
      );

      console.log(
        "🆕 Coluna usd adicionada ao histórico de preços."
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Não foi possível migrar card_price_history:",
      error
    );
  }

  /* =======================================================
     MIGRAÇÃO - ORIGEM DO REGISTRO DA POKÉDEX
  ======================================================= */

  try {
    if (
      !hasColumn(
        "pokedex",
        "registration_source"
      )
    ) {
      db.exec(`
        ALTER TABLE pokedex
        ADD COLUMN registration_source TEXT
        NOT NULL
        DEFAULT 'manual'
      `);

      console.log(
        "🆕 Coluna registration_source adicionada à tabela pokedex."
      );
    }
  } catch (error) {
    console.warn(
      "⚠️ Não foi possível migrar registration_source em pokedex:",
      error
    );
  }

  /* =======================================================
     ÍNDICES
  ======================================================= */

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_card_cache_pokemon_name
        ON card_cache(pokemon_name);

      CREATE INDEX IF NOT EXISTS idx_card_price_history_card_id
        ON card_price_history(card_id);

      CREATE INDEX IF NOT EXISTS idx_card_price_history_captured_at
        ON card_price_history(captured_at);

      CREATE INDEX IF NOT EXISTS idx_owned_cards_card_name
        ON owned_cards(card_name);

      CREATE INDEX IF NOT EXISTS idx_pokedex_pokemon_id
        ON pokedex(pokemon_id);

      CREATE INDEX IF NOT EXISTS idx_pokedex_registration_source
        ON pokedex(registration_source);
    `);
  } catch (error) {
    console.warn(
      "⚠️ Não foi possível criar índices auxiliares:",
      error
    );
  }
}

/* =========================================================
   NORMALIZAÇÃO
========================================================= */

function normalizeText(
  value: string
) {
  return value
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/* =========================================================
   TRADUÇÃO / ALIASES
========================================================= */

const SEARCH_ALIASES: Record<
  string,
  string
> = {
  "energia fogo":
    "Fire Energy",

  "energia de fogo":
    "Fire Energy",

  "fire energy":
    "Fire Energy",

  "energia agua":
    "Water Energy",

  "energia de agua":
    "Water Energy",

  "water energy":
    "Water Energy",

  "energia planta":
    "Grass Energy",

  "energia de planta":
    "Grass Energy",

  "grass energy":
    "Grass Energy",

  /* Energias básicas: a API usa os nomes em inglês. */
  "energia basica":
    "Basic Energy",

  "energia básica":
    "Basic Energy",

  "basic energy":
    "Basic Energy",

  "energia g basica":
    "Basic Grass Energy",

  "energia g básica":
    "Basic Grass Energy",

  "energia grama basica":
    "Basic Grass Energy",

  "energia grama básica":
    "Basic Grass Energy",

  "energia planta basica":
    "Basic Grass Energy",

  "energia planta básica":
    "Basic Grass Energy",

  "basic grass energy":
    "Basic Grass Energy",

  "energia a basica":
    "Basic Water Energy",

  "energia agua basica":
    "Basic Water Energy",

  "energia água básica":
    "Basic Water Energy",

  "basic water energy":
    "Basic Water Energy",

  "energia eletrica basica":
    "Basic Lightning Energy",

  "energia elétrica básica":
    "Basic Lightning Energy",

  "energia raio basica":
    "Basic Lightning Energy",

  "energia raio básica":
    "Basic Lightning Energy",

  "basic lightning energy":
    "Basic Lightning Energy",

  "energia psiquica basica":
    "Basic Psychic Energy",

  "energia psíquica básica":
    "Basic Psychic Energy",

  "basic psychic energy":
    "Basic Psychic Energy",

  "energia luta basica":
    "Basic Fighting Energy",

  "energia luta básica":
    "Basic Fighting Energy",

  "energia lutadora basica":
    "Basic Fighting Energy",

  "basic fighting energy":
    "Basic Fighting Energy",

  "energia metal basica":
    "Basic Metal Energy",

  "energia metal básica":
    "Basic Metal Energy",

  "basic metal energy":
    "Basic Metal Energy",

  "energia trevas basica":
    "Basic Darkness Energy",

  "energia trevas básica":
    "Basic Darkness Energy",

  "energia sombria basica":
    "Basic Darkness Energy",

  "energia sombria básica":
    "Basic Darkness Energy",

  "basic darkness energy":
    "Basic Darkness Energy",

  "energia fada basica":
    "Basic Fairy Energy",

  "energia fada básica":
    "Basic Fairy Energy",

  "basic fairy energy":
    "Basic Fairy Energy",

  "energia incolor basica":
    "Basic Colorless Energy",

  "energia incolor básica":
    "Basic Colorless Energy",

  "energia sem cor basica":
    "Basic Colorless Energy",

  "energia sem cor básica":
    "Basic Colorless Energy",

  "basic colorless energy":
    "Basic Colorless Energy",

  /* Nome localizado da carta de Estádio em português. */
  "floette ange":
    "Ange Floette",

  "ange floette":
    "Ange Floette",

  "energia eletrica":
    "Lightning Energy",

  "energia eletrica de raio":
    "Lightning Energy",

  "energia de raio":
    "Lightning Energy",

  "energia raio":
    "Lightning Energy",

  "lightning energy":
    "Lightning Energy",

  "energia psiquica":
    "Psychic Energy",

  "energia psíquica":
    "Psychic Energy",

  "psychic energy":
    "Psychic Energy",

  "energia luta":
    "Fighting Energy",

  "energia de luta":
    "Fighting Energy",

  "energia lutadora":
    "Fighting Energy",

  "fighting energy":
    "Fighting Energy",

  "energia metal":
    "Metal Energy",

  "energia de metal":
    "Metal Energy",

  "metal energy":
    "Metal Energy",

  "energia trevas":
    "Darkness Energy",

  "energia de trevas":
    "Darkness Energy",

  "energia sombria":
    "Darkness Energy",

  "darkness energy":
    "Darkness Energy",

  "energia fada":
    "Fairy Energy",

  "energia de fada":
    "Fairy Energy",

  "fairy energy":
    "Fairy Energy",

  "energia incolor":
    "Colorless Energy",

  "energia de incolor":
    "Colorless Energy",

  "energia sem cor":
    "Colorless Energy",

  "colorless energy":
    "Colorless Energy",

  "ordens do chefe":
    "Boss's Orders",

  "ordem do chefe":
    "Boss's Orders",

  "boss orders":
    "Boss's Orders",

  "boss's orders":
    "Boss's Orders",

  "bola ninho":
    "Nest Ball",

  "nest ball":
    "Nest Ball",

  "bola ultra":
    "Ultra Ball",

  "ultra bola":
    "Ultra Ball",

  "ultra ball":
    "Ultra Ball",

  "bola grande":
    "Great Ball",

  "great ball":
    "Great Ball",

  "troca":
    "Switch",

  "switch":
    "Switch",

  "poção":
    "Potion",

  "pocao":
    "Potion",

  "professor pesquisa":
    "Professor's Research",

  "pesquisa de professor":
    "Professor's Research",

  "pesquisa do professor":
    "Professor's Research",

  "professor's research":
    "Professor's Research",
};

function translateSearchTerm(
  value: string
) {
  const normalized =
    normalizeText(value);

  return (
    SEARCH_ALIASES[
      normalized
    ] ||
    value.trim()
  );
}

/*
 * Alguns termos representam uma família de cartas, e não um único
 * nome que exista literalmente na Pokémon TCG API.
 *
 * Ex.: "energia básica" deve encontrar todas as energias básicas,
 * enquanto "energia g básica" deve encontrar somente Basic Grass Energy.
 */
function getSearchNameCandidates(
  value: string
): string[] {
  const normalized =
    normalizeText(value);

  const direct =
    SEARCH_ALIASES[
      normalized
    ];

  if (
    direct &&
    normalizeText(direct) !==
      normalized
  ) {
    if (
      normalizeText(direct) ===
      "basic energy"
    ) {
      return [
        "Basic Grass Energy",
        "Basic Water Energy",
        "Basic Lightning Energy",
        "Basic Psychic Energy",
        "Basic Fighting Energy",
        "Basic Metal Energy",
        "Basic Darkness Energy",
        "Basic Fairy Energy",
        "Basic Colorless Energy",
      ];
    }

    return [
      direct,
    ];
  }

  return [
    value.trim(),
  ];
}

/* =========================================================
   CATEGORIA DE CARTA
========================================================= */

function getCardCategory(
  card: TcgCard
): CollectionCategory {
  const supertype =
    (
      card.supertype ||
      ""
    ).toLowerCase();

  const subtypes =
    (
      card.subtypes ||
      []
    )
      .join(" ")
      .toLowerCase();

  if (
    supertype.includes(
      "energy"
    )
  ) {
    return "energy";
  }

  if (
    subtypes.includes(
      "stadium"
    )
  ) {
    return "stadium";
  }

  if (
    supertype.includes(
      "trainer"
    )
  ) {
    return "trainer";
  }

  if (
    supertype.includes(
      "pokémon"
    ) ||
    supertype.includes(
      "pokemon"
    )
  ) {
    return "pokemon";
  }

  if (
    card.name
      .toLowerCase()
      .includes(
        "stadium"
      )
  ) {
    return "stadium";
  }

  return "trainer";
}

function categoryLabel(
  category: CollectionCategory
) {
  switch (
    category
  ) {
    case "pokemon":
      return "Pokémon";

    case "trainer":
      return "Treinadores";

    case "energy":
      return "Energias";

    case "stadium":
      return "Estádios";
  }
}

/* =========================================================
   POKÉMON
========================================================= */

function findPokemonByName(
  db: DatabaseSync,
  name: string
): PokemonRow | null {
  const rows =
    db
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

  const target =
    normalizeText(name);

  const exact =
    rows.find(
      (row) =>
        normalizeText(
          row.name
        ) === target
    );

  if (exact) {
    return exact;
  }

  const partial =
    rows.find(
      (row) =>
        normalizeText(
          row.name
        ).includes(
          target
        )
    );

  return partial || null;
}

function findPokemonByDexNumber(
  db: DatabaseSync,
  nationalDexNumber: number
): PokemonRow | null {
  if (
    !Number.isInteger(
      nationalDexNumber
    ) ||
    nationalDexNumber <= 0
  ) {
    return null;
  }

  const row =
    db
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
        WHERE national_dex_number = ?
        LIMIT 1
      `)
      .get(
        nationalDexNumber
      ) as
      | PokemonRow
      | undefined;

  return row || null;
}

function serializePokemon(
  pokemon: PokemonRow | null
) {
  if (!pokemon) {
    return null;
  }

  return {
    id:
      pokemon.id,

    pokemonId:
      pokemon.id,

    nationalDexNumber:
      pokemon.national_dex_number,

    name:
      pokemon.name,

    image:
      pokemon.image,

    type1:
      pokemon.type1,

    type2:
      pokemon.type2,

    generation:
      pokemon.generation,
  };
}

function serializeAutoRegisteredPokemon(
  pokemon: PokemonRow | null
) {
  if (!pokemon) {
    return null;
  }

  return {
    id:
      pokemon.id,

    pokemonId:
      pokemon.id,

    nationalDexNumber:
      pokemon.national_dex_number,

    name:
      pokemon.name,

    image:
      pokemon.image,

    type1:
      pokemon.type1,

    type2:
      pokemon.type2,

    generation:
      pokemon.generation,
  };
}

/* =========================================================
   CACHE DE CARTAS
========================================================= */

function saveCardsToCache(
  db: DatabaseSync,
  pokemonName: string,
  cards: TcgCard[]
) {
  if (
    cards.length ===
    0
  ) {
    return;
  }

  const statement =
    db.prepare(`
      INSERT INTO card_cache (
        card_id,
        pokemon_name,
        card_json,
        cached_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(card_id)
      DO UPDATE SET
        pokemon_name = excluded.pokemon_name,
        card_json = excluded.card_json,
        cached_at = excluded.cached_at
    `);

  const now =
    new Date().toISOString();

  try {
    db.exec(
      "BEGIN"
    );

    for (
      const card of
        cards
    ) {
      if (
        !card ||
        typeof card.id !==
          "string"
      ) {
        continue;
      }

      statement.run(
        card.id,
        pokemonName,
        JSON.stringify(
          card
        ),
        now
      );
    }

    db.exec(
      "COMMIT"
    );

    console.log(
      `💾 Cache SQLite salvo: ${pokemonName} (${cards.length} carta(s))`
    );
  } catch (error) {
    try {
      db.exec(
        "ROLLBACK"
      );
    } catch {}

    console.warn(
      "⚠️ Falha ao salvar cache:",
      error
    );
  }
}

function updateCardInCache(
  db: DatabaseSync,
  pokemonName: string,
  card: TcgCard
) {
  try {
    db.prepare(`
      UPDATE card_cache
      SET
        pokemon_name = ?,
        card_json = ?,
        cached_at = ?
      WHERE card_id = ?
    `).run(
      pokemonName,
      JSON.stringify(
        card
      ),
      new Date().toISOString(),
      card.id
    );
  } catch (error) {
    console.warn(
      `⚠️ Falha ao atualizar cache ${card.id}:`,
      error
    );
  }
}

function getCardsFromCache(
  db: DatabaseSync,
  pokemonName: string
): TcgCard[] {
  const rows =
    db
      .prepare(`
        SELECT
          card_json
        FROM card_cache
        WHERE LOWER(pokemon_name) =
          LOWER(?)
        ORDER BY card_id
      `)
      .all(
        pokemonName
      ) as Array<{
        card_json: string;
      }>;

  const cards: TcgCard[] =
    [];

  for (
    const row of
      rows
  ) {
    try {
      const card =
        JSON.parse(
          row.card_json
        ) as TcgCard;

      if (
        card &&
        typeof card.id ===
          "string" &&
        typeof card.name ===
          "string"
      ) {
        cards.push(
          card
        );
      }
    } catch {
      console.warn(
        "⚠️ Registro inválido no cache ignorado."
      );
    }
  }

  return cards;
}

/* =========================================================
   PREÇOS
========================================================= */

function getCachedPrice(
  db: DatabaseSync,
  cardId: string
) {
  const row =
    db
      .prepare(`
        SELECT
          usd,
          source,
          updated_at
        FROM card_price_cache
        WHERE card_id = ?
        LIMIT 1
      `)
      .get(
        cardId
      ) as
      | {
          usd:
            number | null;

          source:
            string | null;

          updated_at:
            string;
        }
      | undefined;

  return row || null;
}

function getBrazilDateKey() {
  return new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone:
        "America/Sao_Paulo",

      year:
        "numeric",

      month:
        "2-digit",

      day:
        "2-digit",
    }
  ).format(
    new Date()
  );
}

function saveDailyPriceHistory(
  db: DatabaseSync,
  cardId: string,
  brl: number | null,
  usd: number | null,
  source: string | null
) {
  if (
    !cardId
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  const todayKey =
    getBrazilDateKey();

  try {
    const existing =
      db
        .prepare(`
          SELECT
            id,
            usd,
            brl,
            source,
            captured_at
          FROM card_price_history
          WHERE card_id = ?
            AND substr(captured_at, 1, 10) = ?
          ORDER BY id DESC
          LIMIT 1
        `)
        .get(
          cardId,
          todayKey
        ) as
        | {
            id: number;
            usd: number | null;
            brl: number | null;
            source: string | null;
            captured_at: string;
          }
        | undefined;

    if (existing) {
      const nextBrl =
        typeof brl ===
          "number" &&
        Number.isFinite(
          brl
        ) &&
        brl > 0
          ? brl
          : existing.brl ??
            null;

      const nextUsd =
        typeof usd ===
          "number" &&
        Number.isFinite(
          usd
        ) &&
        usd > 0
          ? usd
          : existing.usd ??
            null;

      const nextSource =
        source ||
        existing.source ||
        null;

      const changed =
        nextBrl !==
          existing.brl ||
        nextUsd !==
          existing.usd ||
        nextSource !==
          existing.source;

      if (changed) {
        db.prepare(`
          UPDATE card_price_history
          SET
            usd = ?,
            brl = ?,
            source = ?,
            captured_at = ?
          WHERE id = ?
        `).run(
          nextUsd,
          nextBrl,
          nextSource,
          now,
          existing.id
        );
      }

      return;
    }

    db.prepare(`
      INSERT INTO card_price_history (
        card_id,
        usd,
        brl,
        source,
        captured_at
      )
      VALUES (?, ?, ?, ?, ?)
    `).run(
      cardId,

      typeof usd ===
        "number" &&
        Number.isFinite(
          usd
        ) &&
        usd > 0
        ? usd
        : null,

      typeof brl ===
        "number" &&
        Number.isFinite(
          brl
        ) &&
        brl > 0
        ? brl
        : null,

      source ||
        null,

      now
    );

    console.log(
      `📈 Snapshot diário salvo: ${cardId} (${todayKey})`
    );
  } catch (error) {
    console.warn(
      `⚠️ Falha ao salvar snapshot diário de ${cardId}:`,
      error
    );
  }
}

function saveCachedPrice(
  db: DatabaseSync,
  cardId: string,
  usd: number,
  source: string
) {
  if (
    !Number.isFinite(
      usd
    ) ||
    usd <= 0
  ) {
    return;
  }

  const now =
    new Date().toISOString();

  try {
    db.prepare(`
      INSERT INTO card_price_cache (
        card_id,
        usd,
        source,
        updated_at
      )
      VALUES (?, ?, ?, ?)
      ON CONFLICT(card_id)
      DO UPDATE SET
        usd = excluded.usd,
        source = excluded.source,
        updated_at = excluded.updated_at
    `).run(
      cardId,
      usd,
      source,
      now
    );

    saveDailyPriceHistory(
      db,
      cardId,
      null,
      usd,
      source
    );
  } catch (error) {
    console.warn(
      `⚠️ Falha ao salvar preço/histórico de ${cardId}:`,
      error
    );
  }
}

/* =========================================================
   HISTÓRICO DE PREÇO
========================================================= */

function getPriceHistory(
  db: DatabaseSync,
  cardId: string
): PriceHistoryPoint[] {
  const rows =
    db
      .prepare(`
        SELECT
          id,
          usd,
          brl,
          source,
          captured_at
        FROM card_price_history
        WHERE card_id = ?
        ORDER BY captured_at ASC
      `)
      .all(
        cardId
      ) as Array<{
        id:
          number;

        usd:
          number | null;

        brl:
          number | null;

        source:
          string | null;

        captured_at:
          string;
      }>;

  return rows.map(
    (
      row
    ) => ({
      id:
        Number(
          row.id
        ),

      usd:
        typeof row.usd ===
          "number"
          ? row.usd
          : null,

      brl:
        typeof row.brl ===
          "number"
          ? row.brl
          : null,

      source:
        row.source ??
        null,

      capturedAt:
        row.captured_at,
    })
  );
}

function saveManualPriceHistory(
  db: DatabaseSync,
  cardId: string,
  brl: number,
  usd:
    | number
    | null,
  source: string
) {
  saveDailyPriceHistory(
    db,
    cardId,
    brl,
    usd,
    source
  );
}

/* =========================================================
   PREÇO MANUAL
========================================================= */

function getPriceOverride(
  db: DatabaseSync,
  cardId: string
): ManualPriceOverride | null {
  const row =
    db
      .prepare(`
        SELECT
          card_id,
          usd,
          brl,
          source,
          note,
          updated_at
        FROM card_price_override
        WHERE card_id = ?
        LIMIT 1
      `)
      .get(
        cardId
      ) as
      | {
          card_id:
            string;

          usd:
            number | null;

          brl:
            number | null;

          source:
            string | null;

          note:
            string | null;

          updated_at:
            string;
        }
      | undefined;

  if (
    !row
  ) {
    return null;
  }

  return {
    cardId:
      row.card_id,

    usd:
      row.usd,

    brl:
      row.brl,

    source:
      row.source,

    note:
      row.note,

    updatedAt:
      row.updated_at,
  };
}

function saveManualBrlPrice(
  db: DatabaseSync,
  cardId: string,
  brl: number,
  source?: string | null,
  note?: string | null
) {
  if (
    !Number.isFinite(
      brl
    ) ||
    brl <= 0
  ) {
    throw new Error(
      "O preço BRL precisa ser maior que zero."
    );
  }

  const normalizedSource =
    typeof source ===
        "string" &&
    source.trim()
      ? source.trim()
      : "Manual";

  const normalizedNote =
    typeof note ===
        "string" &&
    note.trim()
      ? note.trim()
      : null;

  const now =
    new Date().toISOString();

  const existing =
    getPriceOverride(
      db,
      cardId
    );

  db.prepare(`
    INSERT INTO card_price_override (
      card_id,
      usd,
      brl,
      source,
      note,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id)
    DO UPDATE SET
      brl = excluded.brl,
      source = excluded.source,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run(
    cardId,
    existing?.usd ??
      null,
    brl,
    normalizedSource,
    normalizedNote,
    now
  );

  saveManualPriceHistory(
    db,
    cardId,
    brl,
    existing?.usd ??
      null,
    normalizedSource
  );

  console.log(
    `💰 Preço manual salvo: ${cardId} = R$ ${brl.toFixed(
      2
    )}`
  );

  return getPriceOverride(
    db,
    cardId
  );
}

function deleteManualPrice(
  db: DatabaseSync,
  cardId: string
) {
  const result =
    db
      .prepare(`
        DELETE FROM card_price_override
        WHERE card_id = ?
      `)
      .run(
        cardId
      );

  return (
    result.changes >
    0
  );
}

/* =========================================================
   CARTAS POSSUÍDAS
========================================================= */

function getOwnedCard(
  db: DatabaseSync,
  cardId: string
): OwnedCardRecord | null {
  const row =
    db
      .prepare(`
        SELECT
          card_id,
          card_name,
          set_id,
          set_name,
          card_number,
          image,
          added_at,
          quantity
        FROM owned_cards
        WHERE card_id = ?
        LIMIT 1
      `)
      .get(
        cardId
      ) as
      | {
          card_id:
            string;

          card_name:
            string;

          set_id:
            string | null;

          set_name:
            string | null;

          card_number:
            string | null;

          image:
            string | null;

          added_at:
            string;

          quantity:
            number | bigint;
        }
      | undefined;

  if (
    !row
  ) {
    return null;
  }

  return {
    cardId:
      row.card_id,

    cardName:
      row.card_name,

    setId:
      row.set_id,

    setName:
      row.set_name,

    cardNumber:
      row.card_number,

    image:
      row.image,

    addedAt:
      row.added_at,

    quantity:
      Math.max(
        1,
        Number(
          row.quantity ??
            1
        )
      ),
  };
}

function getOwnedQuantity(
  db: DatabaseSync,
  cardId: string
) {
  const row =
    db
      .prepare(`
        SELECT quantity
        FROM owned_cards
        WHERE card_id = ?
        LIMIT 1
      `)
      .get(
        cardId
      ) as
      | {
          quantity:
            number | bigint;
        }
      | undefined;

  return Math.max(
    0,
    Number(
      row?.quantity ??
        0
    )
  );
}

/* =========================================================
   CONTAGEM / RESUMO DA COLEÇÃO
========================================================= */

function getCollectionSummary(
  db: DatabaseSync
) {
  const result: {
    all: CollectionSummaryItem;
    pokemon: CollectionSummaryItem;
    trainer: CollectionSummaryItem;
    energy: CollectionSummaryItem;
    stadium: CollectionSummaryItem;
  } = {
    all: {
      models:
        0,
      quantity:
        0,
    },

    pokemon: {
      models:
        0,
      quantity:
        0,
    },

    trainer: {
      models:
        0,
      quantity:
        0,
    },

    energy: {
      models:
        0,
      quantity:
        0,
    },

    stadium: {
      models:
        0,
      quantity:
        0,
    },
  };

  const rows =
    db
      .prepare(`
        SELECT
          o.card_id,
          o.quantity,
          c.card_json
        FROM owned_cards o
        INNER JOIN card_cache c
          ON c.card_id =
             o.card_id
      `)
      .all() as Array<{
        card_id:
          string;

        quantity:
          number | bigint;

        card_json:
          string;
      }>;

  for (
    const row of
      rows
  ) {
    let card:
      | TcgCard
      | null =
      null;

    try {
      card =
        JSON.parse(
          row.card_json
        ) as TcgCard;
    } catch {
      continue;
    }

    if (
      !card
    ) {
      continue;
    }

    const category =
      getCardCategory(
        card
      );

    const quantity =
      Math.max(
        0,
        Number(
          row.quantity ??
            0
        )
      );

    result.all.models +=
      1;

    result.all.quantity +=
      quantity;

    result[
      category
    ].models +=
      1;

    result[
      category
    ].quantity +=
      quantity;
  }

  return result;
}

/* =========================================================
   CARTAS DA PASTA
========================================================= */

async function getCollectionCards(
  db: DatabaseSync,
  collection:
    | CollectionCategory
    | "all"
): Promise<TcgCard[]> {
  const rows =
    db
      .prepare(`
        SELECT
          c.card_json
        FROM owned_cards o
        INNER JOIN card_cache c
          ON c.card_id =
             o.card_id
        ORDER BY
          c.card_id
      `)
      .all() as Array<{
        card_json:
          string;
      }>;

  const cards: TcgCard[] =
    [];

  for (
    const row of
      rows
  ) {
    try {
      const card =
        JSON.parse(
          row.card_json
        ) as TcgCard;

      if (
        !card ||
        typeof card.id !==
          "string" ||
        typeof card.name !==
          "string"
      ) {
        continue;
      }

      if (
        collection ===
          "all" ||
        getCardCategory(
          card
        ) ===
          collection
      ) {
        cards.push(
          card
        );
      }
    } catch {
      console.warn(
        "⚠️ Registro inválido ignorado ao montar pasta."
      );
    }
  }

  return cards;
}

function sortCards(
  cards: TcgCard[]
) {
  return cards.sort(
    (
      a,
      b
    ) => {
      const categoryA =
        getCardCategory(
          a
        );

      const categoryB =
        getCardCategory(
          b
        );

      const catCompare =
        categoryLabel(
          categoryA
        ).localeCompare(
          categoryLabel(
            categoryB
          )
        );

      if (
        catCompare !==
        0
      ) {
        return catCompare;
      }

      const setA =
        String(
          a.set?.name ||
            ""
        );

      const setB =
        String(
          b.set?.name ||
            ""
        );

      const setCompare =
        setA.localeCompare(
          setB
        );

      if (
        setCompare !==
        0
      ) {
        return setCompare;
      }

      return String(
        a.number ||
          ""
      ).localeCompare(
        String(
          b.number ||
            ""
        ),
        undefined,
        {
          numeric:
            true,
        }
      );
    }
  );
}

/* =========================================================
   +1 CARTA
========================================================= */

function addOwnedCard(
  db: DatabaseSync,
  card: TcgCard
) {
  const existing =
    getOwnedCard(
      db,
      card.id
    );

  if (
    !existing
  ) {
    const now =
      new Date().toISOString();

    db.prepare(`
      INSERT INTO owned_cards (
        card_id,
        card_name,
        set_id,
        set_name,
        card_number,
        image,
        added_at,
        quantity
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      card.id,
      card.name,
      card.set?.id ??
        null,
      card.set?.name ??
        null,
      card.number ??
        null,
      card.images?.large ??
        card.images?.small ??
        null,
      now
    );

    console.log(
      `➕ Carta adicionada à coleção: ${card.id} (1x)`
    );

    return 1;
  }

  const nextQuantity =
    Math.max(
      1,
      existing.quantity +
        1
    );

  db.prepare(`
    UPDATE owned_cards
    SET
      quantity = ?
    WHERE card_id = ?
  `).run(
    nextQuantity,
    card.id
  );

  console.log(
    `➕ Carta duplicada adicionada: ${card.id} (${nextQuantity}x)`
  );

  return nextQuantity;
}

/* =========================================================
   IDENTIFICAR POKÉMON DA CARTA
========================================================= */

function findPokemonForCard(
  db: DatabaseSync,
  card: TcgCard
): PokemonRow | null {
  const dexNumbers =
    Array.isArray(
      card.nationalPokedexNumbers
    )
      ? card.nationalPokedexNumbers
      : [];

  for (
    const dex of
      dexNumbers
  ) {
    const pokemon =
      findPokemonByDexNumber(
        db,
        Number(dex)
      );

    if (
      pokemon
    ) {
      return pokemon;
    }
  }

  return findPokemonByName(
    db,
    card.name
  );
}

/* =========================================================
   ORIGEM DO REGISTRO
========================================================= */

function getPokemonRegistrationSource(
  db: DatabaseSync,
  pokemonId: number
): PokemonRegistrationSource {
  const row =
    db
      .prepare(`
        SELECT
          registration_source
        FROM pokedex
        WHERE pokemon_id = ?
        LIMIT 1
      `)
      .get(
        pokemonId
      ) as
      | {
          registration_source:
            string | null;
        }
      | undefined;

  return row
    ?.registration_source ===
    "card"
    ? "card"
    : "manual";
}

/* =========================================================
   LIBERAR POKÉMON AUTOMÁTICO
========================================================= */

function releaseAutoRegisteredPokemonIfEmpty(
  db: DatabaseSync,
  card: TcgCard
) {
  const pokemon =
    findPokemonForCard(
      db,
      card
    );

  if (
    !pokemon
  ) {
    return {
      released:
        false,

      pokemon:
        null,
    };
  }

  const source =
    getPokemonRegistrationSource(
      db,
      pokemon.id
    );

  /*
   * Registro feito pelo scanner permanece,
   * mesmo quando não existirem cartas.
   */
  if (
    source !==
    "card"
  ) {
    return {
      released:
        false,

      pokemon:
        null,
    };
  }

  const ownedQuantity =
    getOwnedQuantityForPokemon(
      db,
      pokemon.name
    );

  if (
    ownedQuantity >
    0
  ) {
    return {
      released:
        false,

      pokemon:
        null,
    };
  }

  const result =
    db
      .prepare(`
        DELETE FROM pokedex
        WHERE pokemon_id = ?
          AND registration_source = 'card'
      `)
      .run(
        pokemon.id
      );

  if (
    result.changes >
    0
  ) {
    console.log(
      `🔓 Pokémon liberado da Pokédex: ${pokemon.name} — nenhuma carta restante.`
    );

    return {
      released:
        true,

      pokemon:
        pokemon,
    };
  }

  return {
    released:
      false,

    pokemon:
      null,
  };
}

/* =========================================================
   MARCAR CARTA COMO POSSUÍDA / REMOVER
========================================================= */

function setOwnedCard(
  db: DatabaseSync,
  card: TcgCard,
  owned: boolean
): SetOwnedResult {
  if (
    !owned
  ) {
    const result =
      removeOwnedCard(
        db,
        card.id
      );

    let releasedPokemon:
      | AutoRegisteredPokemon
      | null =
      null;

    if (
      result.quantity ===
        0 &&
      result.removed
    ) {
      const release =
        releaseAutoRegisteredPokemonIfEmpty(
          db,
          card
        );

      if (
        release.released &&
        release.pokemon
      ) {
        releasedPokemon =
          serializeAutoRegisteredPokemon(
            release.pokemon
          );
      }
    }

    return {
      owned:
        result.owned,

      quantity:
        result.quantity,

      autoRegisteredPokemon:
        releasedPokemon,

      alreadyRegistered:
        false,
    };
  }

  const quantity =
    addOwnedCard(
      db,
      card
    );

  const pokemon =
    findPokemonForCard(
      db,
      card
    );

  if (
    !pokemon
  ) {
    return {
      owned:
        true,

      quantity,

      autoRegisteredPokemon:
        null,

      alreadyRegistered:
        false,
    };
  }

  const existing =
    db
      .prepare(`
        SELECT
          id,
          pokemon_id,
          registered_at,
          registration_source
        FROM pokedex
        WHERE pokemon_id = ?
        LIMIT 1
      `)
      .get(
        pokemon.id
      ) as
      | {
          id: number;
          pokemon_id: number;
          registered_at:
            string | null;
          registration_source:
            string | null;
        }
      | undefined;

  if (
    existing
  ) {
    return {
      owned:
        true,

      quantity,

      autoRegisteredPokemon:
        null,

      alreadyRegistered:
        true,
    };
  }

  const registeredAt =
    new Date().toISOString();

  db.prepare(`
    INSERT INTO pokedex (
      pokemon_id,
      registered_at,
      registration_source
    )
    VALUES (?, ?, 'card')
  `).run(
    pokemon.id,
    registeredAt
  );

  console.log(
    `✅ Pokémon registrado automaticamente pela carta: ${pokemon.name}`
  );

  return {
    owned:
      true,

    quantity,

    autoRegisteredPokemon:
      serializeAutoRegisteredPokemon(
        pokemon
      ),

    alreadyRegistered:
      false,
  };
}

/* =========================================================
   -1 CARTA
========================================================= */

function removeOwnedCard(
  db: DatabaseSync,
  cardId: string
) {
  const existing =
    getOwnedCard(
      db,
      cardId
    );

  if (
    !existing
  ) {
    return {
      owned:
        false,

      quantity:
        0,

      removed:
        false,
    };
  }

  if (
    existing.quantity <=
    1
  ) {
    db.prepare(`
      DELETE FROM owned_cards
      WHERE card_id = ?
    `).run(
      cardId
    );

    console.log(
      `○ Última unidade removida da coleção: ${cardId}`
    );

    return {
      owned:
        false,

      quantity:
        0,

      removed:
        true,
    };
  }

  const nextQuantity =
    existing.quantity -
    1;

  db.prepare(`
    UPDATE owned_cards
    SET
      quantity = ?
    WHERE card_id = ?
  `).run(
    nextQuantity,
    cardId
  );

  console.log(
    `➖ Uma unidade removida: ${cardId} (${nextQuantity}x)`
  );

  return {
    owned:
      true,

    quantity:
      nextQuantity,

    removed:
      true,
  };
}

/* =========================================================
   CONTAGEM DE CARTAS POSSUÍDAS
========================================================= */

function getOwnedCountForPokemon(
  db: DatabaseSync,
  pokemonName: string
) {
  const row =
    db
      .prepare(`
        SELECT
          COUNT(
            DISTINCT owned_cards.card_id
          ) AS total
        FROM owned_cards
        INNER JOIN card_cache
          ON card_cache.card_id =
             owned_cards.card_id
        WHERE LOWER(
          card_cache.pokemon_name
        ) = LOWER(?)
      `)
      .get(
        pokemonName
      ) as
      | {
          total:
            number | bigint;
        }
      | undefined;

  return Number(
    row?.total ??
      0
  );
}

function getOwnedQuantityForPokemon(
  db: DatabaseSync,
  pokemonName: string
) {
  const row =
    db
      .prepare(`
        SELECT
          COALESCE(
            SUM(
              owned_cards.quantity
            ),
            0
          ) AS total
        FROM owned_cards
        INNER JOIN card_cache
          ON card_cache.card_id =
             owned_cards.card_id
        WHERE LOWER(
          card_cache.pokemon_name
        ) = LOWER(?)
      `)
      .get(
        pokemonName
      ) as
      | {
          total:
            number | bigint;
        }
      | undefined;

  return Number(
    row?.total ??
      0
  );
}

/* =========================================================
   TCGPLAYER
========================================================= */

function getTcgPlayerPrice(
  card: TcgCard
): number | null {
  const prices =
    card.tcgplayer?.prices;

  if (
    !prices
  ) {
    return null;
  }

  const preferredVariants = [
    "normal",
    "holofoil",
    "reverseHolofoil",
    "1stEditionNormal",
    "1stEditionHolofoil",
  ];

  for (
    const variant of
      preferredVariants
  ) {
    const value =
      prices[
        variant
      ]?.market;

    if (
      typeof value ===
        "number" &&
      Number.isFinite(
        value
      ) &&
      value > 0
    ) {
      return value;
    }
  }

  for (
    const variant of
      preferredVariants
  ) {
    const value =
      prices[
        variant
      ]?.mid;

    if (
      typeof value ===
        "number" &&
      Number.isFinite(
        value
      ) &&
      value > 0
    ) {
      return value;
    }
  }

  for (
    const variant of
      preferredVariants
  ) {
    const value =
      prices[
        variant
      ]?.low;

    if (
      typeof value ===
        "number" &&
      Number.isFinite(
        value
      ) &&
      value > 0
    ) {
      return value;
    }
  }

  for (
    const value of
      Object.values(
        prices
      )
  ) {
    if (
      typeof value?.market ===
        "number" &&
      Number.isFinite(
        value.market
      ) &&
      value.market > 0
    ) {
      return value.market;
    }

    if (
      typeof value?.mid ===
        "number" &&
      Number.isFinite(
        value.mid
      ) &&
      value.mid > 0
    ) {
      return value.mid;
    }

    if (
      typeof value?.low ===
        "number" &&
      Number.isFinite(
        value.low
      ) &&
      value.low > 0
    ) {
      return value.low;
    }
  }

  return null;
}

/* =========================================================
   RESOLVE PREÇO
========================================================= */

function resolvePrice(
  db: DatabaseSync,
  card: TcgCard
) {
  const override =
    getPriceOverride(
      db,
      card.id
    );

  if (
    override &&
    typeof override.brl ===
      "number" &&
    override.brl > 0
  ) {
    const tcgPlayer =
      getTcgPlayerPrice(
        card
      );

    return {
      usd:
        typeof tcgPlayer ===
          "number"
          ? tcgPlayer
          : typeof override.usd ===
              "number"
            ? override.usd
            : null,

      brl:
        override.brl,

      source:
        override.source ||
        "Manual",

      local:
        true,

      note:
        override.note ||
        "Preço informado manualmente em BRL.",

      manualBrl:
        true,
    };
  }

  const tcgPlayer =
    getTcgPlayerPrice(
      card
    );

  if (
    typeof tcgPlayer ===
      "number" &&
    tcgPlayer > 0
  ) {
    saveCachedPrice(
      db,
      card.id,
      tcgPlayer,
      "TCGPlayer"
    );

    return {
      usd:
        tcgPlayer,

      brl:
        null as
          | number
          | null,

      source:
        "TCGPlayer",

      local:
        false,

      note:
        null as
          | string
          | null,

      manualBrl:
        false,
    };
  }

  const cached =
    getCachedPrice(
      db,
      card.id
    );

  if (
    cached &&
    typeof cached.usd ===
      "number" &&
    cached.usd > 0
  ) {
    return {
      usd:
        cached.usd,

      brl:
        null as
          | number
          | null,

      source:
        cached.source ||
        "Cache",

      local:
        true,

      note:
        "Preço recuperado do cache local.",

      manualBrl:
        false,
    };
  }

  if (
    override &&
    typeof override.usd ===
      "number" &&
    override.usd > 0
  ) {
    return {
      usd:
        override.usd,

      brl:
        null as
          | number
          | null,

      source:
        override.source ||
        "Local",

      local:
        true,

      note:
        override.note ||
        null,

      manualBrl:
        false,
    };
  }

  return {
    usd:
      null as
        | number
        | null,

    brl:
      null as
        | number
        | null,

    source:
      null as
        | string
        | null,

    local:
      false,

    note:
      null as
        | string
        | null,

    manualBrl:
      false,
  };
}

/* =========================================================
   IMAGENS
========================================================= */

function getImageCandidates(
  card: TcgCard
) {
  const result: string[] =
    [];

  if (
    card.images?.large
  ) {
    result.push(
      card.images.large
    );
  }

  if (
    card.images?.small
  ) {
    result.push(
      card.images.small
    );
  }

  if (
    card.set?.id &&
    card.number
  ) {
    const setId =
      encodeURIComponent(
        card.set.id
      );

    const number =
      encodeURIComponent(
        card.number
      );

    result.push(
      `https://images.pokemontcg.io/${setId}/${number}_hires.png`
    );

    result.push(
      `https://images.pokemontcg.io/${setId}/${number}.png`
    );
  }

  return Array.from(
    new Set(
      result.filter(
        (
          value
        ) =>
          typeof value ===
            "string" &&
          value.trim().length >
            0
      )
    )
  );
}

function buildProxyUrl(
  imageUrl:
    | string
    | null
    | undefined
) {
  if (
    !imageUrl
  ) {
    return null;
  }

  return `/api/card?imageUrl=${encodeURIComponent(
    imageUrl
  )}`;
}

/* =========================================================
   CÂMBIO
========================================================= */

async function fetchExchangeRates(): Promise<ExchangeRates> {
  if (
    exchangeCache &&
    exchangeCache.expiresAt >
      Date.now()
  ) {
    return exchangeCache.value;
  }

  try {
    const response =
      await fetch(
        "https://api.frankfurter.app/latest?from=USD&to=BRL,EUR",
        {
          cache:
            "no-store",
        }
      );

    if (
      response.ok
    ) {
      const data =
        (await response.json()) as {
          rates?: {
            BRL?: number;
            EUR?: number;
          };
        };

      const rates: ExchangeRates =
        {
          brl:
            typeof data.rates
              ?.BRL ===
            "number"
              ? data.rates.BRL
              : null,

          eur:
            typeof data.rates
              ?.EUR ===
            "number"
              ? data.rates.EUR
              : null,
        };

      if (
        rates.brl !==
          null ||
        rates.eur !==
          null
      ) {
        exchangeCache = {
          value:
            rates,

          expiresAt:
            Date.now() +
            EXCHANGE_CACHE_MS,
        };

        return rates;
      }
    }
  } catch {
    console.warn(
      "⚠️ Frankfurter indisponível."
    );
  }

  try {
    const response =
      await fetch(
        "https://open.er-api.com/v6/latest/USD",
        {
          cache:
            "no-store",
        }
      );

    if (
      response.ok
    ) {
      const data =
        (await response.json()) as {
          rates?: Record<
            string,
            number
          >;
        };

      const rates: ExchangeRates =
        {
          brl:
            typeof data.rates
              ?.BRL ===
            "number"
              ? data.rates.BRL
              : null,

          eur:
            typeof data.rates
              ?.EUR ===
            "number"
              ? data.rates.EUR
              : null,
        };

      if (
        rates.brl !==
          null ||
        rates.eur !==
          null
      ) {
        exchangeCache = {
          value:
            rates,

          expiresAt:
            Date.now() +
            EXCHANGE_CACHE_MS,
        };

        return rates;
      }
    }
  } catch {
    console.warn(
      "⚠️ ExchangeRate indisponível."
    );
  }

  try {
    const db =
      getDatabase();

    ensureAuxiliaryTables(
      db
    );

    const brlRow =
      db
        .prepare(`
          SELECT
            rate
          FROM exchange_rate_cache
          WHERE base_currency =
            'USD'
            AND target_currency =
            'BRL'
          LIMIT 1
        `)
        .get() as
        | {
            rate:
              number;
          }
        | undefined;

    const eurRow =
      db
        .prepare(`
          SELECT
            rate
          FROM exchange_rate_cache
          WHERE base_currency =
            'USD'
            AND target_currency =
            'EUR'
          LIMIT 1
        `)
        .get() as
        | {
            rate:
              number;
          }
        | undefined;

    const rates: ExchangeRates =
      {
        brl:
          brlRow?.rate ??
          null,

        eur:
          eurRow?.rate ??
          null,
      };

    db.close();

    return rates;
  } catch {
    return {
      brl:
        null,

      eur:
        null,
    };
  }
}

function saveExchangeRates(
  db: DatabaseSync,
  rates: ExchangeRates
) {
  const now =
    new Date().toISOString();

  if (
    typeof rates.brl ===
      "number" &&
    rates.brl > 0
  ) {
    db.prepare(`
      INSERT INTO exchange_rate_cache (
        base_currency,
        target_currency,
        rate,
        updated_at
      )
      VALUES (
        'USD',
        'BRL',
        ?,
        ?
      )
      ON CONFLICT(
        base_currency,
        target_currency
      )
      DO UPDATE SET
        rate =
          excluded.rate,
        updated_at =
          excluded.updated_at
    `).run(
      rates.brl,
      now
    );
  }

  if (
    typeof rates.eur ===
      "number" &&
    rates.eur > 0
  ) {
    db.prepare(`
      INSERT INTO exchange_rate_cache (
        base_currency,
        target_currency,
        rate,
        updated_at
      )
      VALUES (
        'USD',
        'EUR',
        ?,
        ?
      )
      ON CONFLICT(
        base_currency,
        target_currency
      )
      DO UPDATE SET
        rate =
          excluded.rate,
        updated_at =
          excluded.updated_at
    `).run(
      rates.eur,
      now
    );
  }
}

/* =========================================================
   HELPERS FETCH
========================================================= */

function sleep(
  ms: number
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs: number
): Promise<T | null> {
  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () =>
        controller.abort(),
      timeoutMs
    );

  try {
    const headers: HeadersInit =
      {
        Accept:
          "application/json",
      };

    if (
      process.env
        .POKEMON_TCG_API_KEY
    ) {
      headers[
        "X-Api-Key"
      ] =
        process.env
          .POKEMON_TCG_API_KEY;
    }

    const response =
      await fetch(
        url,
        {
          method:
            "GET",

          headers,

          cache:
            "no-store",

          signal:
            controller.signal,
        }
      );

    if (
      !response.ok
    ) {
      return null;
    }

    return (
      (await response.json()) as T
    );
  } catch {
    return null;
  } finally {
    clearTimeout(
      timer
    );
  }
}

async function fetchJsonWithRetry(
  url: string
): Promise<unknown> {
  let lastError:
    | unknown =
    new Error(
      "Falha desconhecida."
    );

  for (
    let attempt = 1;
    attempt <=
    MAX_RETRIES;
    attempt++
  ) {
    const controller =
      new AbortController();

    const timer =
      setTimeout(
        () =>
          controller.abort(),
        REQUEST_TIMEOUT_MS
      );

    try {
      console.log(
        `🌐 Pokémon TCG API - tentativa ${attempt}/${MAX_RETRIES}`
      );

      const headers: HeadersInit =
        {
          Accept:
            "application/json",
        };

      if (
        process.env
          .POKEMON_TCG_API_KEY
      ) {
        headers[
          "X-Api-Key"
        ] =
          process.env
            .POKEMON_TCG_API_KEY;
      }

      const response =
        await fetch(
          url,
          {
            method:
              "GET",

            headers,

            cache:
              "no-store",

            signal:
              controller.signal,
          }
        );

      const body =
        await response.text();

      console.log(
        `📡 Status da API: ${response.status}`
      );

      if (
        response.ok
      ) {
        try {
          return JSON.parse(
            body
          );
        } catch {
          lastError =
            new Error(
              "A API retornou JSON inválido."
            );
        }
      } else {
        lastError =
          new Error(
            `Pokémon TCG API respondeu ${response.status}${
              body
                ? `: ${body.slice(
                    0,
                    500
                  )}`
                : ""
            }`
          );

        console.warn(
          `❌ Tentativa ${attempt} falhou:`,
          lastError
        );
      }
    } catch (
      error
    ) {
      lastError =
        error;

      console.warn(
        `❌ Erro na tentativa ${attempt}:`,
        error
      );
    } finally {
      clearTimeout(
        timer
      );
    }

    if (
      attempt <
      MAX_RETRIES
    ) {
      await sleep(
        400 *
          attempt
      );
    }
  }

  throw (
    lastError instanceof
      Error
      ? lastError
      : new Error(
          "Falha ao consultar a Pokémon TCG API."
        )
  );
}

/* =========================================================
   BUSCAR CARTAS PELO NOME
========================================================= */

async function fetchCardsByPokemonName(
  pokemonName: string,
  db?: DatabaseSync
): Promise<TcgCard[]> {
  const searchTerm =
    pokemonName.trim();

  if (!searchTerm) {
    return [];
  }

  /*
   * Para Pokémon, mantemos a busca por nome do Pokémon e suas variantes.
   * Para Treinadores, Estádios e Energias, a busca passa a aceitar o nome
   * real da carta, inclusive quando a API usa outra ordem/idioma.
   */
  const candidates =
    getSearchNameCandidates(
      searchTerm
    );

  const pokemon =
    db
      ? findPokemonByName(
          db,
          searchTerm
        )
      : null;

  const isPokemonSearch =
    Boolean(pokemon);

  const cardsById =
    new Map<
      string,
      TcgCard
    >();

  for (
    const candidateName of
      candidates
  ) {
    const safeName =
      candidateName
        .trim()
        .replace(
          /"/g,
          '\\\"'
        );

    if (!safeName) {
      continue;
    }

    /*
     * A forma entre aspas é a mais importante:
     * - evita 400 quando o nome contém espaços;
     * - funciona para "Ange Floette";
     * - funciona para "Basic Grass Energy".
     *
     * Para termos com mais de uma palavra, também tentamos cada palavra
     * isoladamente. Isso deixa a busca mais resistente a variações de nome
     * e a oscilações 500/502 da API.
     */
    const words =
      normalizeText(
        candidateName
      )
        .split(" ")
        .filter(
          Boolean
        );

    const queries = [
      `name:"${safeName}"`,
      ...(
        words.length > 1
          ? words.map(
              (word) =>
                `name:${word}`
            )
          : []
      ),
    ];

    for (
      const query of
        queries
    ) {
      try {
        const url =
          new URL(
            POKEMON_TCG_API_URL
          );

        url.searchParams.set(
          "q",
          query
        );

        url.searchParams.set(
          "page",
          "1"
        );

        url.searchParams.set(
          "pageSize",
          "250"
        );

        const raw =
          await fetchJsonWithRetry(
            url.toString()
          );

        if (
          !raw ||
          typeof raw !==
            "object"
        ) {
          continue;
        }

        const data =
          (
            raw as {
              data?: unknown;
            }
          ).data;

        if (
          !Array.isArray(
            data
          )
        ) {
          continue;
        }

        for (
          const item of
            data
        ) {
          if (
            !item ||
            typeof item !==
              "object"
          ) {
            continue;
          }

          const candidate =
            item as {
              id?: unknown;
              name?: unknown;
            };

          if (
            typeof candidate.id !==
              "string" ||
            typeof candidate.name !==
              "string"
          ) {
            continue;
          }

          cardsById.set(
            candidate.id,
            item as TcgCard
          );
        }
      } catch (
        error
      ) {
        console.warn(
          `⚠️ Consulta complementar falhou para "${query}":`,
          error
        );
      }
    }
  }

  const normalizedSearch =
    normalizeText(
      searchTerm
    );

  const normalizedCandidates =
    candidates.map(
      normalizeText
    );

  const allTokens =
    normalizedSearch
      .split(" ")
      .filter(
        (token) =>
          token.length > 1
      );

  const isBasicEnergyFamily =
    normalizedSearch ===
      "basic energy" ||
    normalizedSearch ===
      "energia basica";

  return Array.from(
    cardsById.values()
  )
    .filter(
      (
        card
      ) => {
        const normalizedCardName =
          normalizeText(
            card.name
          );

        /*
         * BUSCA DE POKÉMON
         *
         * Aqui mantemos o comportamento antigo para não transformar uma
         * busca por Pokémon em uma lista de treinadores que apenas cite o
         * Pokémon no nome.
         */
        if (
          isPokemonSearch
        ) {
          const pokemonBase =
            normalizedSearch;

          return (
            normalizedCardName ===
              pokemonBase ||
            normalizedCardName.startsWith(
              `${pokemonBase} `
            ) ||
            normalizedCardName.startsWith(
              `mega ${pokemonBase} `
            )
          );
        }

        /*
         * BUSCA DE CARTAS GENÉRICAS
         *
         * Todos os termos relevantes precisam aparecer no nome, em qualquer
         * ordem. Isso resolve "Floette Ange" -> "Ange Floette".
         */
        if (
          normalizedCandidates.some(
            (
              candidate
            ) => {
              if (
                candidate ===
                normalizedCardName
              ) {
                return true;
              }

              const candidateTokens =
                candidate
                  .split(" ")
                  .filter(
                    (token) =>
                      token.length > 1
                  );

              return candidateTokens.every(
                (
                  token
                ) =>
                  normalizedCardName.includes(
                    token
                  )
              );
            }
          )
        ) {
          return true;
        }

        /*
         * "Energia básica" é uma família. Se a API devolver qualquer uma das
         * nove energias básicas, ela deve aparecer.
         */
        if (
          isBasicEnergyFamily &&
          normalizedCardName.startsWith(
            "basic "
          ) &&
          normalizedCardName.endsWith(
            " energy"
          )
        ) {
          return true;
        }

        /*
         * Fallback tolerante para termos simples, como "Grass":
         * todos os tokens digitados precisam existir no nome da carta.
         */
        if (
          allTokens.length > 0
        ) {
          return allTokens.every(
            (
              token
            ) =>
              normalizedCardName.includes(
                token
              )
          );
        }

        return false;
      }
    )
    .sort(
      (
        a,
        b
      ) => {
        const nameA =
          normalizeText(
            a.name
          );

        const nameB =
          normalizeText(
            b.name
          );

        const exactA =
          normalizedCandidates.includes(
            nameA
          )
            ? 0
            : 1;

        const exactB =
          normalizedCandidates.includes(
            nameB
          )
            ? 0
            : 1;

        if (
          exactA !==
          exactB
        ) {
          return (
            exactA -
            exactB
          );
        }

        return nameA.localeCompare(
          nameB
        );
      }
    );
}

/* =========================================================
   CARTA INDIVIDUAL
========================================================= */

async function fetchCardById(
  cardId: string,
  timeoutMs =
    PRICE_REFRESH_TIMEOUT_MS
): Promise<TcgCard | null> {
  const url =
    `${POKEMON_TCG_API_URL}/${encodeURIComponent(
      cardId
    )}`;

  const raw =
    await fetchJsonWithTimeout<
      unknown
    >(
      url,
      timeoutMs
    );

  if (
    !raw ||
    typeof raw !==
      "object"
  ) {
    return null;
  }

  const maybeData =
    (
      raw as {
        data?: unknown;
      }
    ).data;

  const candidate =
    maybeData &&
    typeof maybeData ===
      "object"
      ? maybeData
      : raw;

  if (
    !candidate ||
    typeof candidate !==
      "object"
  ) {
    return null;
  }

  const parsed =
    candidate as {
      id?: unknown;
      name?: unknown;
    };

  if (
    typeof parsed.id !==
      "string" ||
    typeof parsed.name !==
      "string"
  ) {
    return null;
  }

  return (
    candidate as TcgCard
  );
}

/* =========================================================
   REFRESH PREÇOS AUSENTES
========================================================= */

async function refreshMissingPrices(
  db: DatabaseSync,
  pokemonName: string,
  cards: TcgCard[]
) {
  const missing =
    cards.filter(
      (
        card
      ) =>
        !getTcgPlayerPrice(
          card
        ) &&
        !getCachedPrice(
          db,
          card.id
        ) &&
        !getPriceOverride(
          db,
          card.id
        )
    );

  if (
    missing.length ===
    0
  ) {
    return {
      cards,
      refreshed:
        0,
    };
  }

  const refreshedCards =
    [
      ...cards,
    ];

  let refreshed =
    0;

  for (
    let i = 0;
    i < missing.length;
    i += 3
  ) {
    const batch =
      missing.slice(
        i,
        i + 3
      );

    const results =
      await Promise.all(
        batch.map(
          async (
            card
          ) => {
            try {
              console.log(
                `💰 Tentando recuperar preço da impressão ${card.id}`
              );

              const fresh =
                await fetchCardById(
                  card.id
                );

              if (
                !fresh
              ) {
                return false;
              }

              const index =
                refreshedCards.findIndex(
                  (
                    item
                  ) =>
                    item.id ===
                    card.id
                );

              if (
                index >=
                0
              ) {
                refreshedCards[
                  index
                ] =
                  mergeCardData(
                    card,
                    fresh
                  );

                updateCardInCache(
                  db,
                  pokemonName,
                  refreshedCards[
                    index
                  ]
                );
              }

              const usd =
                getTcgPlayerPrice(
                  fresh
                );

              if (
                typeof usd ===
                  "number" &&
                usd > 0
              ) {
                saveCachedPrice(
                  db,
                  card.id,
                  usd,
                  "TCGPlayer"
                );

                console.log(
                  `💰 Preço recuperado para ${card.id}: USD ${usd}`
                );

                return true;
              }

              return false;
            } catch (
              error
            ) {
              console.warn(
                `⚠️ Não foi possível atualizar preço de ${card.id}:`,
                error
              );

              return false;
            }
          }
        )
      );

    refreshed +=
      results.filter(
        Boolean
      ).length;
  }

  return {
    cards:
      refreshedCards,

    refreshed,
  };
}

function mergeCardData(
  oldCard: TcgCard,
  freshCard: TcgCard
): TcgCard {
  return {
    ...oldCard,

    ...freshCard,

    set:
      freshCard.set ||
      oldCard.set,

    images:
      freshCard.images ||
      oldCard.images,

    tcgplayer:
      freshCard.tcgplayer ||
      oldCard.tcgplayer,

    cardmarket:
      freshCard.cardmarket ||
      oldCard.cardmarket,

    nationalPokedexNumbers:
      freshCard.nationalPokedexNumbers ||
      oldCard.nationalPokedexNumbers,
  };
}

/* =========================================================
   SERIALIZAÇÃO
========================================================= */

function serializeCard(
  db: DatabaseSync,
  card: TcgCard,
  rates: ExchangeRates
) {
  const price =
    resolvePrice(
      db,
      card
    );

  const usd =
    price.usd;

  const brl =
    typeof price.brl ===
      "number" &&
    price.brl > 0
      ? price.brl
      : typeof usd ===
            "number" &&
        typeof rates.brl ===
            "number" &&
        rates.brl > 0
        ? usd *
          rates.brl
        : null;

  const eur =
    typeof usd ===
      "number" &&
    typeof rates.eur ===
      "number" &&
    rates.eur > 0
      ? usd *
        rates.eur
      : null;

  const images =
    getImageCandidates(
      card
    );

  const directImage =
    images[0] ||
    null;

  const manualOverride =
    getPriceOverride(
      db,
      card.id
    );

  const ownedRecord =
    getOwnedCard(
      db,
      card.id
    );

  const owned =
    Boolean(
      ownedRecord
    );

  const ownedQuantity =
    ownedRecord
      ?.quantity ??
    0;

  const history =
    getPriceHistory(
      db,
      card.id
    );

  const normalizedHistory =
    history.map(
      (
        point
      ) => ({
        ...point,

        brl:
          typeof point.brl ===
              "number" &&
          point.brl > 0
            ? point.brl
            : typeof point.usd ===
                  "number" &&
              typeof rates.brl ===
                  "number" &&
              rates.brl > 0
              ? point.usd *
                rates.brl
              : null,
      })
    );

  const historyBrl =
    typeof brl ===
        "number" &&
    brl > 0
      ? brl
      : null;

  saveDailyPriceHistory(
    db,
    card.id,
    historyBrl,
    typeof usd ===
        "number" &&
      usd > 0
      ? usd
      : null,
    price.source
  );

  const refreshedHistory =
    getPriceHistory(
      db,
      card.id
    );

  const finalHistory =
    refreshedHistory.map(
      (
        point
      ) => ({
        ...point,

        brl:
          typeof point.brl ===
              "number" &&
          point.brl > 0
            ? point.brl
            : typeof point.usd ===
                  "number" &&
              typeof rates.brl ===
                  "number" &&
              rates.brl > 0
              ? point.usd *
                rates.brl
              : null,
      })
    );

  /*
   * Mantém normalizedHistory calculado para compatibilidade
   * com versões anteriores do route.
   */
  void normalizedHistory;

  return {
    id:
      card.id,

    name:
      card.name,

    number:
      card.number ??
      null,

    rarity:
      card.rarity ??
      null,

    supertype:
      card.supertype ??
      null,

    subtypes:
      card.subtypes ??
      [],

    nationalPokedexNumbers:
      card.nationalPokedexNumbers ??
      [],

    set: {
      id:
        card.set?.id ??
        null,

      name:
        card.set?.name ??
        null,

      series:
        card.set?.series ??
        null,

      releaseDate:
        card.set
          ?.releaseDate ??
        null,

      printedTotal:
        card.set
          ?.printedTotal ??
        null,

      total:
        card.set?.total ??
        null,
    },

    collectionCategory:
      getCardCategory(
        card
      ),

    image:
      buildProxyUrl(
        directImage
      ),

    directImage,

    imageCandidates:
      images.map(
        buildProxyUrl
      ),

    priceUsd:
      usd,

    priceBrl:
      brl,

    priceEur:
      eur,

    prices: {
      usd,
      brl,
      eur,
    },

    priceSource:
      price.source,

    priceIsLocal:
      price.local,

    priceNote:
      price.note,

    priceHistory:
      finalHistory,

    manualPrice:
      manualOverride
        ? {
            cardId:
              manualOverride.cardId,

            brl:
              manualOverride.brl,

            usd:
              manualOverride.usd,

            source:
              manualOverride.source,

            note:
              manualOverride.note,

            updatedAt:
              manualOverride.updatedAt,
          }
        : null,

    isManualPrice:
      price.manualBrl,

    owned,

    ownedQuantity,

    ownedCard:
      ownedRecord
        ? {
            cardId:
              ownedRecord.cardId,

            cardName:
              ownedRecord.cardName,

            setId:
              ownedRecord.setId,

            setName:
              ownedRecord.setName,

            cardNumber:
              ownedRecord.cardNumber,

            image:
              ownedRecord.image,

            addedAt:
              ownedRecord.addedAt,

            quantity:
              ownedRecord.quantity,
          }
        : null,

    hasImage:
      images.length >
      0,

    hasPrice:
      (
        typeof usd ===
          "number" &&
        usd > 0
      ) ||
      (
        typeof brl ===
          "number" &&
        brl > 0
      ),

    tcgplayer: {
      url:
        card
          .tcgplayer
          ?.url ??
        null,

      updatedAt:
        card
          .tcgplayer
          ?.updatedAt ??
        null,
    },

    cardmarket: {
      url:
        card
          .cardmarket
          ?.url ??
        null,

      updatedAt:
        card
          .cardmarket
          ?.updatedAt ??
        null,
    },
  };
}

/* =========================================================
   GET
========================================================= */

export async function GET(
  request: Request
) {
  const db =
    getDatabase();

  try {
    ensureAuxiliaryTables(
      db
    );

    const url =
      new URL(
        request.url
      );

    const search =
      url.searchParams
        .get(
          "search"
        )
        ?.trim() ||
      "";

    const collection =
      url.searchParams.get(
        "collection"
      );

    /* =====================================================
       RESUMO
    ===================================================== */

    const collectionSummary =
      getCollectionSummary(
        db
      );

    /* =====================================================
       BUSCA POR COLEÇÃO
    ===================================================== */

    if (
      collection ===
        "all" ||
      collection ===
        "pokemon" ||
      collection ===
        "trainer" ||
      collection ===
        "energy" ||
      collection ===
        "stadium"
    ) {
      console.log(
        `📂 /api/pokedex pasta: ${collection}`
      );

      const rawCards =
        await getCollectionCards(
          db,
          collection
        );

      let rates:
        | ExchangeRates = {
        brl:
          null,

        eur:
          null,
      };

      if (
        rawCards.length >
        0
      ) {
        rates =
          await fetchExchangeRates();

        saveExchangeRates(
          db,
          rates
        );
      }

      const serialized =
        rawCards.map(
          (
            card
          ) =>
            serializeCard(
              db,
              card,
              rates
            )
        );

      serialized.sort(
        (
          a,
          b
        ) => {
          const ownedA =
            a.owned
              ? 0
              : 1;

          const ownedB =
            b.owned
              ? 0
              : 1;

          if (
            ownedA !==
            ownedB
          ) {
            return (
              ownedA -
              ownedB
            );
          }

          const setA =
            String(
              a.set?.name ||
                ""
            );

          const setB =
            String(
              b.set?.name ||
                ""
            );

          const setCompare =
            setA.localeCompare(
              setB
            );

          if (
            setCompare !==
            0
          ) {
            return setCompare;
          }

          return String(
            a.number ||
              ""
          ).localeCompare(
            String(
              b.number ||
                ""
            ),
            undefined,
            {
              numeric:
                true,
            }
          );
        }
      );

      return NextResponse.json({
        success:
          true,

        collection,

        cards:
          serialized,

        entries:
          serialized,

        total:
          serialized.length,

        totalModels:
          serialized.length,

        totalQuantity:
          serialized.reduce(
            (
              total,
              card
            ) =>
              total +
              Number(
                card.ownedQuantity ??
                  0
              ),
            0
          ),

        summary:
          collectionSummary,

        source:
          "collection",

        cached:
          true,

        exchangeRates: {
          usdToBrl:
            rates.brl,

          usdToEur:
            rates.eur,
        },
      });
    }

    /* =====================================================
       BUSCA POR NOME
    ===================================================== */

    if (
      search
    ) {
      console.log(
        `🔎 /api/pokedex busca: ${search}`
      );

      const pokemon =
        findPokemonByName(
          db,
          search
        );

      const translatedSearch =
        translateSearchTerm(
          search
        );

      const officialName =
        pokemon?.name ||
        translatedSearch;

      if (
        normalizeText(
          search
        ) !==
        normalizeText(
          translatedSearch
        )
      ) {
        console.log(
          `🌎 Busca traduzida: "${search}" → "${translatedSearch}"`
        );
      }

      let cards:
        | TcgCard[]
        | null =
        null;

      let source:
        | SourceType =
        "none";

      /* ===================================================
         CACHE
      =================================================== */

      const cachedCards =
        getCardsFromCache(
          db,
          officialName
        );

      if (
        cachedCards.length >
        0
      ) {
        cards =
          cachedCards;

        source =
          "cache";

        console.log(
          `💾 Cache encontrado: ${cachedCards.length} carta(s) para ${officialName}.`
        );

        /*
         * Busca novamente variantes novas, inclusive
         * Mega, ex, EX, Gold, V e outras impressões.
         */
        try {
          console.log(
            `🔄 Verificando novas variantes na API: ${officialName}`
          );

          const apiCards =
            await fetchCardsByPokemonName(
              officialName,
              db
            );

          const mergedById =
            new Map<
              string,
              TcgCard
            >();

          for (
            const card of
              cachedCards
          ) {
            mergedById.set(
              card.id,
              card
            );
          }

          for (
            const card of
              apiCards
          ) {
            mergedById.set(
              card.id,
              card
            );
          }

          const mergedCards =
            Array.from(
              mergedById.values()
            );

          if (
            mergedCards.length >
            cachedCards.length
          ) {
            console.log(
              `🆕 ${mergedCards.length - cachedCards.length} nova(s) impressão(ões) encontrada(s) para ${officialName}.`
            );

            cards =
              mergedCards;

            saveCardsToCache(
              db,
              officialName,
              mergedCards
            );
          }
        } catch (
          error
        ) {
          console.warn(
            `⚠️ Não foi possível verificar novas impressões de ${officialName}. O cache será mantido.`,
            error
          );
        }

        const refreshResult =
          await refreshMissingPrices(
            db,
            officialName,
            cards
          );

        if (
          refreshResult.refreshed >
          0
        ) {
          cards =
            refreshResult.cards;

          source =
            "cache+price-refresh";
        }
      }

      /* ===================================================
         API
      =================================================== */

      if (
        !cards
      ) {
        try {
          console.log(
            `🌐 Nenhum cache local. Buscando API: ${officialName}`
          );

          const apiCards =
            await fetchCardsByPokemonName(
              officialName,
              db
            );

          cards =
            apiCards;

          source =
            "api";

          if (
            apiCards.length >
            0
          ) {
            saveCardsToCache(
              db,
              officialName,
              apiCards
            );
          }
        } catch (
          error
        ) {
          console.error(
            "❌ Falha na busca da API:",
            error
          );

          const fallbackCache =
            getCardsFromCache(
              db,
              officialName
            );

          if (
            fallbackCache.length >
            0
          ) {
            cards =
              fallbackCache;

            source =
              "cache";

            console.log(
              `💾 Fallback para cache: ${fallbackCache.length} carta(s).`
            );
          } else {
            return NextResponse.json(
              {
                success:
                  false,

                search,

                pokemon:
                  serializePokemon(
                    pokemon
                  ),

                cards:
                  [],

                entries:
                  [],

                total:
                  0,

                source:
                  "none",

                cached:
                  false,

                message:
                  "Não foi possível consultar as cartas e não existe cache local.",
              },
              {
                status:
                  200,
              }
            );
          }
        }
      }

      /* ===================================================
         CÂMBIO
      =================================================== */

      const rates =
        await fetchExchangeRates();

      saveExchangeRates(
        db,
        rates
      );

      console.log(
        "💱 Câmbio:",
        rates
      );

      /* ===================================================
         SERIALIZA
      =================================================== */

      const serialized =
        (
          cards || []
        ).map(
          (
            card
          ) =>
            serializeCard(
              db,
              card,
              rates
            )
        );

      /* ===================================================
         CONTADORES
      =================================================== */

      const ownedCount =
        serialized.filter(
          (
            card
          ) =>
            card.owned
        ).length;

      const totalCards =
        serialized.length;

      const ownedQuantity =
        serialized.reduce(
          (
            total,
            card
          ) =>
            total +
            Number(
              card.ownedQuantity ??
                0
            ),
          0
        );

      console.log(
        `📚 Coleção ${officialName}: ${ownedCount}/${totalCards} carta(s) possuída(s).`
      );

      console.log(
        `📦 Quantidade física da coleção ${officialName}: ${ownedQuantity} unidade(s).`
      );

      /* ===================================================
         ORDENAÇÃO
      =================================================== */

      serialized.sort(
        (
          a,
          b
        ) => {
          const ownedA =
            a.owned
              ? 0
              : 1;

          const ownedB =
            b.owned
              ? 0
              : 1;

          if (
            ownedA !==
            ownedB
          ) {
            return (
              ownedA -
              ownedB
            );
          }

          const setA =
            String(
              a.set?.name ||
                ""
            );

          const setB =
            String(
              b.set?.name ||
                ""
            );

          const setCompare =
            setA.localeCompare(
              setB
            );

          if (
            setCompare !==
            0
          ) {
            return setCompare;
          }

          return String(
            a.number ||
              ""
          ).localeCompare(
            String(
              b.number ||
                ""
            ),
            undefined,
            {
              numeric:
                true,
            }
          );
        }
      );

      console.log(
        `✅ Busca concluída: ${serialized.length} carta(s) para ${officialName}.`
      );

      return NextResponse.json({
        success:
          true,

        search,

        searchName:
          officialName,

        pokemon:
          serializePokemon(
            pokemon
          ),

        isPokemonSearch:
          Boolean(
            pokemon
          ),

        searchTranslation:
          normalizeText(
            search
          ) !==
          normalizeText(
            translatedSearch
          )
            ? translatedSearch
            : null,

        cards:
          serialized,

        entries:
          serialized,

        total:
          totalCards,

        ownedCount,

        missingCount:
          totalCards -
          ownedCount,

        ownedQuantity,

        source,

        cached:
          source ===
            "cache" ||
          source ===
            "cache+price-refresh",

        exchangeRates: {
          usdToBrl:
            rates.brl,

          usdToEur:
            rates.eur,
        },

        summary:
          collectionSummary,

        message:
          source ===
          "cache+price-refresh"
            ? "Cartas carregadas do cache e preços ausentes foram atualizados."
            : source ===
                "cache"
              ? "Cartas carregadas do cache local."
              : "Cartas carregadas da API.",
      });
    }

    /* =====================================================
       LISTA DA POKÉDEX
    ===================================================== */

    const rows =
      db
        .prepare(`
          SELECT
            d.id,
            d.pokemon_id,
            d.registered_at,
            d.registration_source,

            p.name,
            p.national_dex_number,
            p.image,
            p.type1,
            p.type2,
            p.generation

          FROM pokedex d

          INNER JOIN pokemon p
            ON p.id = d.pokemon_id

          ORDER BY
            p.national_dex_number ASC
        `)
        .all() as Array<{
        id:
          number;

        pokemon_id:
          number;

        registered_at:
          string | null;

        registration_source:
          string | null;

        name:
          string;

        national_dex_number:
          number;

        image:
          string | null;

        type1:
          string | null;

        type2:
          string | null;

        generation:
          number | null;
      }>;

    console.log(
      `📖 Pokédex: ${rows.length} registrado(s).`
    );

    const entries =
      rows.map(
        (
          row
        ) => {
          const ownedModels =
            getOwnedCountForPokemon(
              db,
              row.name
            );

          const ownedQuantity =
            getOwnedQuantityForPokemon(
              db,
              row.name
            );

          return {
            id:
              row.id,

            pokemonId:
              row.pokemon_id,

            pokemon_id:
              row.pokemon_id,

            name:
              row.name,

            nationalDexNumber:
              row.national_dex_number,

            national_dex_number:
              row.national_dex_number,

            image:
              row.image,

            type1:
              row.type1,

            type2:
              row.type2,

            generation:
              row.generation,

            registeredAt:
              row.registered_at,

            registered_at:
              row.registered_at,

            registrationSource:
              row.registration_source ===
              "card"
                ? "card"
                : "manual",

            card_count:
              ownedModels,

            owned_quantity:
              ownedQuantity,
          };
        }
      );

    return NextResponse.json({
      success:
        true,

      entries,

      pokemon:
        entries,

      total:
        entries.length,

      summary:
        collectionSummary,
    });
  } catch (
    error
  ) {
    console.error(
      "❌ GET /api/pokedex:",
      error
    );

    return NextResponse.json(
      {
        success:
          false,

        message:
          "Não foi possível carregar a Pokédex.",

        entries:
          [],

        cards:
          [],

        total:
          0,
      },
      {
        status:
          500,
      }
    );
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
  const db =
    getDatabase();

  try {
    ensureAuxiliaryTables(
      db
    );

    const body =
      await request.json();

    /* =====================================================
       PREÇO MANUAL
    ===================================================== */

    if (
      body?.action ===
      "setPrice"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      const brl =
        typeof body?.brl ===
          "number"
          ? body.brl
          : Number(
              String(
                body?.brl ??
                  ""
              )
                .replace(
                  "R$",
                  ""
                )
                .replace(
                  /\./g,
                  ""
                )
                .replace(
                  ",",
                  "."
                )
                .trim()
            );

      const source =
        typeof body?.source ===
          "string"
          ? body.source
          : null;

      const note =
        typeof body?.note ===
          "string"
          ? body.note
          : null;

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      if (
        !cardRow
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Essa impressão ainda não está cadastrada no cache.",
          },
          {
            status:
              404,
          }
        );
      }

      if (
        !Number.isFinite(
          brl
        ) ||
        brl <= 0
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Informe um valor BRL maior que zero.",
          },
          {
            status:
              400,
          }
        );
      }

      const override =
        saveManualBrlPrice(
          db,
          cardId,
          brl,
          source,
          note
        );

      const history =
        getPriceHistory(
          db,
          cardId
        );

      return NextResponse.json({
        success:
          true,

        action:
          "setPrice",

        cardId,

        price: {
          brl:
            override?.brl ??
            brl,

          usd:
            override?.usd ??
            null,

          eur:
            null,

          source:
            override?.source ??
            source ??
            "Manual",

          note:
            override?.note ??
            note ??
            null,

          updatedAt:
            override?.updatedAt ??
            new Date().toISOString(),
        },

        priceHistory:
          history,
      });
    }

    /* =====================================================
       MARCAR CARTA POSSUÍDA
    ===================================================== */

    if (
      body?.action ===
      "setOwned"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      const owned =
        body?.owned ===
        true;

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      if (
        !cardRow
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Carta não encontrada no cache local.",
          },
          {
            status:
              404,
          }
        );
      }

      let card:
        | TcgCard
        | null =
        null;

      try {
        card =
          JSON.parse(
            cardRow.card_json
          ) as TcgCard;
      } catch {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Não foi possível ler os dados desta carta.",
          },
          {
            status:
              500,
          }
        );
      }

      const existingBefore =
        getOwnedCard(
          db,
          cardId
        );

      const result =
        setOwnedCard(
          db,
          card,
          owned
        );

      const ownedCardsRow =
        db
          .prepare(`
            SELECT
              COUNT(*) AS total_models,
              COALESCE(
                SUM(quantity),
                0
              ) AS total_quantity
            FROM owned_cards
          `)
          .get() as
          | {
              total_models:
                number | bigint;

              total_quantity:
                number | bigint;
            }
          | undefined;

      const releasedPokemon =
        result.autoRegisteredPokemon;

      return NextResponse.json({
        success:
          true,

        action:
          "setOwned",

        cardId,

        owned:
          result.owned,

        quantity:
          result.quantity,

        previousQuantity:
          existingBefore?.quantity ??
          0,

        totalOwned:
          Number(
            ownedCardsRow?.total_models ??
              0
          ),

        totalOwnedQuantity:
          Number(
            ownedCardsRow?.total_quantity ??
              0
          ),

        autoRegisteredPokemon:
          releasedPokemon,

        releasedPokemon,

        alreadyRegistered:
          result.alreadyRegistered,

        summary:
          getCollectionSummary(
            db
          ),

        message:
          releasedPokemon
            ? !owned
              ? `Carta removida. ${releasedPokemon.name} foi liberado da Pokédex porque nenhuma carta dele permaneceu na coleção.`
              : `Carta marcada como possuída. ${releasedPokemon.name} foi registrado automaticamente na sua Pokédex.`
            : !owned
              ? "Carta removida da coleção."
              : result.quantity >
                  1
                ? `Carta continua na coleção com ${result.quantity} unidades.`
                : result.alreadyRegistered
                  ? "Carta marcada como possuída. O Pokémon já estava na sua Pokédex."
                  : "Carta marcada como possuída.",
      });
    }

    /* =====================================================
       TROCAR CARTA
    ===================================================== */

    if (
      body?.action ===
      "tradeOwned"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      const requestedQuantity =
        Number(
          body?.quantity ??
            1
        );

      const tradeQuantity =
        Number.isFinite(
          requestedQuantity
        )
          ? Math.max(
              1,
              Math.floor(
                requestedQuantity
              )
            )
          : 1;

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      if (
        !cardRow
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Carta não encontrada no cache local.",
          },
          {
            status:
              404,
          }
        );
      }

      let card:
        | TcgCard
        | null =
        null;

      try {
        card =
          JSON.parse(
            cardRow.card_json
          ) as TcgCard;
      } catch {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Não foi possível ler os dados desta carta.",
          },
          {
            status:
              500,
          }
        );
      }

      const existing =
        getOwnedCard(
          db,
          cardId
        );

      if (
        !existing
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Você não possui esta carta para troca.",
          },
          {
            status:
              400,
          }
        );
      }

      if (
        tradeQuantity >
        existing.quantity
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              `Você possui somente ${existing.quantity} unidade(s) desta carta.`,
          },
          {
            status:
              400,
          }
        );
      }

      const newQuantity =
        existing.quantity -
        tradeQuantity;

      if (
        newQuantity <=
        0
      ) {
        db.prepare(`
          DELETE FROM owned_cards
          WHERE card_id = ?
        `).run(
          cardId
        );
      } else {
        db.prepare(`
          UPDATE owned_cards
          SET
            quantity = ?
          WHERE card_id = ?
        `).run(
          newQuantity,
          cardId
        );
      }

      let releasedPokemon:
        | AutoRegisteredPokemon
        | null =
        null;

      if (
        newQuantity <=
        0
      ) {
        const release =
          releaseAutoRegisteredPokemonIfEmpty(
            db,
            card
          );

        if (
          release.released &&
          release.pokemon
        ) {
          releasedPokemon =
            serializeAutoRegisteredPokemon(
              release.pokemon
            );
        }
      }

      const ownedCardsRow =
        db
          .prepare(`
            SELECT
              COUNT(*) AS total_models,
              COALESCE(
                SUM(quantity),
                0
              ) AS total_quantity
            FROM owned_cards
          `)
          .get() as
          | {
              total_models:
                number | bigint;

              total_quantity:
                number | bigint;
            }
          | undefined;

      console.log(
        `🔄 Carta trocada: ${cardId} (${tradeQuantity} unidade(s))`
      );

      if (
        releasedPokemon
      ) {
        console.log(
          `🔓 Pokémon liberado após troca: ${releasedPokemon.name}`
        );
      }

      return NextResponse.json({
        success:
          true,

        action:
          "tradeOwned",

        cardId,

        tradedQuantity:
          tradeQuantity,

        previousQuantity:
          existing.quantity,

        quantity:
          newQuantity,

        owned:
          newQuantity >
          0,

        removed:
          newQuantity <=
          0,

        releasedPokemon,

        totalOwned:
          Number(
            ownedCardsRow?.total_models ??
              0
          ),

        totalOwnedQuantity:
          Number(
            ownedCardsRow?.total_quantity ??
              0
          ),

        summary:
          getCollectionSummary(
            db
          ),

        message:
          releasedPokemon
            ? `${tradeQuantity} unidade(s) trocada(s). ${releasedPokemon.name} foi liberado da Pokédex porque nenhuma carta dele permaneceu na coleção.`
            : newQuantity >
                0
              ? `${tradeQuantity} unidade(s) trocada(s). Você ainda possui ${newQuantity} unidade(s) desta carta.`
              : `${tradeQuantity} unidade(s) trocada(s). A carta saiu da sua coleção.`,
      });
    }

    /* =====================================================
       +1 CARTA REPETIDA
    ===================================================== */

    if (
      body?.action ===
      "addOwned"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      if (
        !cardRow
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Carta não encontrada no cache local.",
          },
          {
            status:
              404,
          }
        );
      }

      let card:
        | TcgCard
        | null =
        null;

      try {
        card =
          JSON.parse(
            cardRow.card_json
          ) as TcgCard;
      } catch {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "Não foi possível ler os dados desta carta.",
          },
          {
            status:
              500,
          }
        );
      }

      const quantity =
        addOwnedCard(
          db,
          card
        );

      const ownedCardsRow =
        db
          .prepare(`
            SELECT
              COUNT(*) AS total_models,
              COALESCE(
                SUM(quantity),
                0
              ) AS total_quantity
            FROM owned_cards
          `)
          .get() as
          | {
              total_models:
                number | bigint;

              total_quantity:
                number | bigint;
            }
          | undefined;

      /*
       * Se o Pokémon ainda não estiver na Pokédex,
       * adicionamos automaticamente como "card".
       */
      const pokemon =
        findPokemonForCard(
          db,
          card
        );

      let autoRegisteredPokemon:
        | AutoRegisteredPokemon
        | null =
        null;

      let alreadyRegistered =
        false;

      if (
        pokemon
      ) {
        const existingPokemon =
          db
            .prepare(`
              SELECT
                id,
                registration_source
              FROM pokedex
              WHERE pokemon_id = ?
              LIMIT 1
            `)
            .get(
              pokemon.id
            ) as
            | {
                id: number;
                registration_source:
                  string | null;
              }
            | undefined;

        if (
          existingPokemon
        ) {
          alreadyRegistered =
            true;
        } else {
          const registeredAt =
            new Date().toISOString();

          db.prepare(`
            INSERT INTO pokedex (
              pokemon_id,
              registered_at,
              registration_source
            )
            VALUES (?, ?, 'card')
          `).run(
            pokemon.id,
            registeredAt
          );

          autoRegisteredPokemon =
            serializeAutoRegisteredPokemon(
              pokemon
            );

          console.log(
            `✅ Pokémon registrado automaticamente pela carta: ${pokemon.name}`
          );
        }
      }

      return NextResponse.json({
        success:
          true,

        action:
          "addOwned",

        cardId,

        owned:
          true,

        quantity,

        totalOwned:
          Number(
            ownedCardsRow?.total_models ??
              0
          ),

        totalOwnedQuantity:
          Number(
            ownedCardsRow?.total_quantity ??
              0
          ),

        autoRegisteredPokemon,

        alreadyRegistered,

        summary:
          getCollectionSummary(
            db
          ),

        message:
          autoRegisteredPokemon
            ? `Carta adicionada à coleção. ${autoRegisteredPokemon.name} foi registrado automaticamente na sua Pokédex.`
            : `Você possui ${quantity} unidade(s) desta carta.`,
      });
    }

    /* =====================================================
       -1 CARTA
    ===================================================== */

    if (
      body?.action ===
      "removeOwned"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      const result =
        removeOwnedCard(
          db,
          cardId
        );

      let releasedPokemon:
        | AutoRegisteredPokemon
        | null =
        null;

      if (
        result.quantity ===
          0 &&
        result.removed &&
        cardRow
      ) {
        try {
          const card =
            JSON.parse(
              cardRow.card_json
            ) as TcgCard;

          const release =
            releaseAutoRegisteredPokemonIfEmpty(
              db,
              card
            );

          if (
            release.released &&
            release.pokemon
          ) {
            releasedPokemon =
              serializeAutoRegisteredPokemon(
                release.pokemon
              );
          }
        } catch {}
      }

      const ownedCardsRow =
        db
          .prepare(`
            SELECT
              COUNT(*) AS total_models,
              COALESCE(
                SUM(quantity),
                0
              ) AS total_quantity
            FROM owned_cards
          `)
          .get() as
          | {
              total_models:
                number | bigint;

              total_quantity:
                number | bigint;
            }
          | undefined;

      return NextResponse.json({
        success:
          true,

        action:
          "removeOwned",

        cardId,

        owned:
          result.owned,

        quantity:
          result.quantity,

        removed:
          result.removed,

        releasedPokemon,

        totalOwned:
          Number(
            ownedCardsRow?.total_models ??
              0
          ),

        totalOwnedQuantity:
          Number(
            ownedCardsRow?.total_quantity ??
              0
          ),

        summary:
          getCollectionSummary(
            db
          ),

        message:
          releasedPokemon
            ? `A última unidade foi removida. ${releasedPokemon.name} foi liberado da Pokédex porque foi registrado automaticamente por carta.`
            : result.owned
              ? `Uma unidade removida. Agora você possui ${result.quantity} unidade(s).`
              : "Última unidade removida da coleção.",
      });
    }

    /* =====================================================
       REGISTRAR POKÉMON MANUALMENTE
    ===================================================== */

    const name =
      typeof body?.name ===
        "string"
        ? body.name.trim()
        : "";

    const rawPokemonId =
      body?.pokemonId;

    const pokemonId =
      typeof rawPokemonId ===
        "number"
        ? rawPokemonId
        : Number(
            rawPokemonId
          );

    let pokemon:
      | PokemonRow
      | null =
      null;

    if (
      Number.isInteger(
        pokemonId
      ) &&
      pokemonId > 0
    ) {
      pokemon =
        (
          db
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
              LIMIT 1
            `)
            .get(
              pokemonId
            ) as
            | PokemonRow
            | undefined
        ) || null;
    }

    if (
      !pokemon &&
      name
    ) {
      pokemon =
        findPokemonByName(
          db,
          name
        );
    }

    if (
      !pokemon
    ) {
      return NextResponse.json(
        {
          success:
            false,

          message:
            "Pokémon não encontrado no banco local.",
        },
        {
          status:
            404,
        }
      );
    }

    const existing =
      (
        db
          .prepare(`
            SELECT
              id,
              pokemon_id,
              registered_at,
              registration_source
            FROM pokedex
            WHERE pokemon_id = ?
            LIMIT 1
          `)
          .get(
            pokemon.id
          ) as
          | {
              id:
                number;

              pokemon_id:
                number;

              registered_at:
                string | null;

              registration_source:
                string | null;
            }
          | undefined
      ) || null;

    if (
      existing
    ) {
      /*
       * Se veio originalmente de carta e agora foi capturado
       * pelo scanner, convertemos para manual.
       */
      if (
        existing.registration_source ===
        "card"
      ) {
        db.prepare(`
          UPDATE pokedex
          SET
            registration_source = 'manual'
          WHERE id = ?
        `).run(
          existing.id
        );

        console.log(
          `📷 Pokémon convertido para registro manual pelo scanner: ${pokemon.name}`
        );
      } else {
        console.log(
          `📖 Pokémon já estava na Pokédex: ${pokemon.name}`
        );
      }

      return NextResponse.json({
        success:
          true,

        alreadyExists:
          true,

        entry: {
          id:
            existing.id,

          pokemonId:
            pokemon.id,

          name:
            pokemon.name,

          nationalDexNumber:
            pokemon.national_dex_number,

          image:
            pokemon.image,

          type1:
            pokemon.type1,

          type2:
            pokemon.type2,

          generation:
            pokemon.generation,

          registeredAt:
            existing.registered_at,

          registrationSource:
            "manual",
        },
      });
    }

    const registeredAt =
      new Date().toISOString();

    const inserted =
      db
        .prepare(`
          INSERT INTO pokedex (
            pokemon_id,
            registered_at,
            registration_source
          )
          VALUES (?, ?, 'manual')
        `)
        .run(
          pokemon.id,
          registeredAt
        );

    console.log(
      `✅ Pokémon registrado na Pokédex: ${pokemon.name}`
    );

    return NextResponse.json({
      success:
        true,

      alreadyExists:
        false,

      entry: {
        id:
          Number(
            inserted.lastInsertRowid
          ),

        pokemonId:
          pokemon.id,

        name:
          pokemon.name,

        nationalDexNumber:
          pokemon.national_dex_number,

        image:
          pokemon.image,

        type1:
          pokemon.type1,

        type2:
          pokemon.type2,

        generation:
          pokemon.generation,

        registeredAt,

        registrationSource:
          "manual",
      },
    });
  } catch (
    error
  ) {
    console.error(
      "❌ POST /api/pokedex:",
      error
    );

    return NextResponse.json(
      {
        success:
          false,

        message:
          "Não foi possível processar a operação.",
      },
      {
        status:
          500,
      }
    );
  } finally {
    db.close();
  }
}

/* =========================================================
   DELETE
========================================================= */

export async function DELETE(
  request: Request
) {
  const db =
    getDatabase();

  try {
    ensureAuxiliaryTables(
      db
    );

    const body =
      await request.json();

    /* =====================================================
       REMOVER PREÇO MANUAL
    ===================================================== */

    if (
      body?.action ===
      "deletePrice"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const removed =
        deleteManualPrice(
          db,
          cardId
        );

      return NextResponse.json({
        success:
          true,

        action:
          "deletePrice",

        cardId,

        removed,

        message:
          removed
            ? "Preço manual removido."
            : "Não havia preço manual para esta impressão.",
      });
    }

    /* =====================================================
       REMOVER CARTA DA COLEÇÃO
    ===================================================== */

    if (
      body?.action ===
      "deleteOwned"
    ) {
      const cardId =
        typeof body?.cardId ===
          "string"
          ? body.cardId.trim()
          : "";

      if (
        !cardId
      ) {
        return NextResponse.json(
          {
            success:
              false,

            message:
              "ID da carta não informado.",
          },
          {
            status:
              400,
          }
        );
      }

      const cardRow =
        db
          .prepare(`
            SELECT
              card_json
            FROM card_cache
            WHERE card_id = ?
            LIMIT 1
          `)
          .get(
            cardId
          ) as
          | {
              card_json:
                string;
            }
          | undefined;

      const result =
        db
          .prepare(`
            DELETE FROM owned_cards
            WHERE card_id = ?
          `)
          .run(
            cardId
          );

      let releasedPokemon:
        | AutoRegisteredPokemon
        | null =
        null;

      if (
        result.changes >
          0 &&
        cardRow
      ) {
        try {
          const card =
            JSON.parse(
              cardRow.card_json
            ) as TcgCard;

          const release =
            releaseAutoRegisteredPokemonIfEmpty(
              db,
              card
            );

          if (
            release.released &&
            release.pokemon
          ) {
            releasedPokemon =
              serializeAutoRegisteredPokemon(
                release.pokemon
              );
          }
        } catch {}
      }

      return NextResponse.json({
        success:
          true,

        action:
          "deleteOwned",

        cardId,

        removed:
          result.changes >
          0,

        releasedPokemon,

        summary:
          getCollectionSummary(
            db
          ),
      });
    }

    /* =====================================================
       REMOVER POKÉMON DA POKÉDEX
    ===================================================== */

    const rawId =
      body?.id;

    const id =
      typeof rawId ===
        "number"
        ? rawId
        : Number(
            rawId
          );

    if (
      !Number.isInteger(
        id
      ) ||
      id <= 0
    ) {
      return NextResponse.json(
        {
          success:
            false,

          message:
            "ID inválido.",
        },
        {
          status:
            400,
        }
      );
    }

    const result =
      db
        .prepare(`
          DELETE FROM pokedex
          WHERE id = ?
        `)
        .run(
          id
        );

    if (
      result.changes ===
      0
    ) {
      return NextResponse.json(
        {
          success:
            false,

          message:
            "Registro não encontrado.",
        },
        {
          status:
            404,
        }
      );
    }

    console.log(
      `🗑️ Registro ${id} removido da Pokédex.`
    );

    return NextResponse.json({
      success:
        true,
    });
  } catch (
    error
  ) {
    console.error(
      "❌ DELETE /api/pokedex:",
      error
    );

    return NextResponse.json(
      {
        success:
          false,

        message:
          "Não foi possível executar a remoção.",
      },
      {
        status:
          500,
      }
    );
  } finally {
    db.close();
  }
}