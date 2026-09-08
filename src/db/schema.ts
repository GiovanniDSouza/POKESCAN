import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const pokemonTable = sqliteTable(
  "pokemon",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    nationalDexNumber: integer("national_dex_number")
      .notNull()
      .unique(),

    name: text("name").notNull(),

    image: text("image"),

    type1: text("type1"),

    type2: text("type2"),

    generation: integer("generation"),
  }
);

export const pokedexTable = sqliteTable(
  "pokedex",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),

    pokemonId: integer("pokemon_id")
      .notNull()
      .references(() => pokemonTable.id, {
        onDelete: "cascade",
      }),

    registeredAt: text("registered_at"),
  },
  (table) => ({
    pokemonUnique: uniqueIndex("pokedex_pokemon_unique").on(
      table.pokemonId
    ),
  })
);

export const cardsTable = sqliteTable("cards", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  pokemonId: integer("pokemon_id")
    .references(() => pokemonTable.id, {
      onDelete: "set null",
    }),

  name: text("name").notNull(),

  setName: text("set_name"),

  setCode: text("set_code"),

  cardNumber: text("card_number"),

  rarity: text("rarity"),

  language: text("language"),

  image: text("image"),
});

export const pricesTable = sqliteTable("prices", {
  id: integer("id").primaryKey({ autoIncrement: true }),

  cardId: integer("card_id")
    .notNull()
    .references(() => cardsTable.id, {
      onDelete: "cascade",
    }),

  currency: text("currency").notNull(),

  marketPrice: real("market_price").notNull(),

  source: text("source"),

  updatedAt: text("updated_at").notNull(),
});
