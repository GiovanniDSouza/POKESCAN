import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync("pokescan.sqlite");

type ApiPokemon = {
  id: number;
  name: string;
  types: {
    slot: number;
    type: {
      name: string;
    };
  }[];
};

const TOTAL_POKEMON = 1025;

function capitalize(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function getGeneration(id: number) {
  if (id <= 151) return 1;
  if (id <= 251) return 2;
  if (id <= 386) return 3;
  if (id <= 493) return 4;
  if (id <= 649) return 5;
  if (id <= 721) return 6;
  if (id <= 809) return 7;
  if (id <= 905) return 8;
  return 9;
}

const insert = db.prepare(`
  INSERT INTO pokemon (
    national_dex_number,
    name,
    image,
    type1,
    type2,
    generation
  )
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(national_dex_number)
  DO UPDATE SET
    name = excluded.name,
    image = excluded.image,
    type1 = excluded.type1,
    type2 = excluded.type2,
    generation = excluded.generation
`);

async function getPokemon(id: number): Promise<ApiPokemon> {
  const response = await fetch(
    `https://pokeapi.co/api/v2/pokemon/${id}`
  );

  if (!response.ok) {
    throw new Error(
      `Erro ao consultar Pokémon #${id}: ${response.status}`
    );
  }

  return response.json() as Promise<ApiPokemon>;
}

async function main() {
  console.log("====================================");
  console.log("      IMPORTADOR DO POKÉSCAN");
  console.log("====================================");
  console.log(`Importando ${TOTAL_POKEMON} Pokémon...`);
  console.log("");

  let imported = 0;

  for (let id = 1; id <= TOTAL_POKEMON; id++) {
    try {
      const pokemon = await getPokemon(id);

      const type1 =
        pokemon.types.find((type) => type.slot === 1)?.type.name ??
        null;

      const type2 =
        pokemon.types.find((type) => type.slot === 2)?.type.name ??
        null;

      const image =
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

      insert.run(
        id,
        capitalize(pokemon.name),
        image,
        type1,
        type2,
        getGeneration(id)
      );

      imported++;

      console.log(
        `[${imported}/${TOTAL_POKEMON}] #${String(id).padStart(4, "0")} ${capitalize(pokemon.name)}`
      );
    } catch (error) {
      console.error(`❌ Falha no Pokémon #${id}`);
      console.error(error);
    }
  }

  const result = db
    .prepare("SELECT COUNT(*) AS total FROM pokemon")
    .get() as { total: number };

  console.log("");
  console.log("====================================");
  console.log("IMPORTAÇÃO CONCLUÍDA!");
  console.log(`Pokémon no banco: ${result.total}`);
  console.log("====================================");

  db.close();
}

main().catch((error) => {
  console.error("");
  console.error("❌ Erro fatal durante a importação:");
  console.error(error);
  db.close();
  process.exit(1);
});
