"use client";

import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

/* =========================================================
   TIPOS
========================================================= */

type RegisteredPokemon = {
  id: number;

  pokemonId?: number;
  pokemon_id?: number;

  nationalDexNumber?: number;
  national_dex_number?: number;

  name: string;

  image?: string | null;

  type1?: string | null;
  type2?: string | null;

  generation?: number | null;

  registeredAt?: string | null;
  registered_at?: string | null;

  card_count?: number;
  owned_quantity?: number;

  registrationSource?: "manual" | "card";
};

type ManualPrice = {
  cardId?: string | null;

  brl?: number | null;
  usd?: number | null;

  source?: string | null;
  note?: string | null;

  updatedAt?: string | null;
};

type SearchCard = {
  id: string;
  name: string;

  number?: string | null;
  rarity?: string | null;

  supertype?: string | null;
  subtypes?: string[];

  set?: {
    id?: string | null;
    name?: string | null;
    series?: string | null;

    releaseDate?: string | null;
    printedTotal?: number | null;
    total?: number | null;
  } | null;

  image?: string | null;
  directImage?: string | null;

  imageCandidates?: Array<
    string | null
  >;

  nationalPokedexNumbers?: number[];

  prices?: {
    usd?: number | null;
    brl?: number | null;
    eur?: number | null;
  };

  priceUsd?: number | null;
  priceBrl?: number | null;
  priceEur?: number | null;

  priceSource?: string | null;
  priceIsLocal?: boolean;
  priceNote?: string | null;

  manualPrice?: ManualPrice | null;
  isManualPrice?: boolean;

  owned?: boolean;
  ownedQuantity?: number;

  ownedCard?: {
    cardId?: string | null;
    cardName?: string | null;

    setId?: string | null;
    setName?: string | null;

    cardNumber?: string | null;
    image?: string | null;

    addedAt?: string | null;

    quantity?: number;
  } | null;

  hasImage?: boolean;
  hasPrice?: boolean;

  priceHistory?: PriceHistoryPoint[];

  collectionCategory?: CollectionCategory;
};

type CollectionCategory =
  | "pokemon"
  | "trainer"
  | "energy"
  | "stadium";

type PriceHistoryPoint = {
  brl?: number | null;
  usd?: number | null;
  source?: string | null;
  capturedAt?: string | null;
};

type CollectionSummaryItem = {
  models: number;
  quantity: number;
};

type PokedexResponse = {
  success: boolean;

  entries?: RegisteredPokemon[];
  pokemon?: RegisteredPokemon[];

  cards?: SearchCard[];

  total?: number;
  totalModels?: number;
  totalQuantity?: number;

  ownedCount?: number;
  missingCount?: number;

  ownedQuantity?: number;
  totalOwnedQuantity?: number;

  search?: string;
  searchName?: string;

  source?: string;
  cached?: boolean;

  exchangeRates?: {
    usdToBrl?: number | null;
    usdToEur?: number | null;
  };

  error?: string;
  message?: string;

  action?: string;
  cardId?: string;

  quantity?: number;

  totalOwned?: number;
  totalOwnedQuantity?: number;

  autoRegisteredPokemon?: RegisteredPokemon | null;
  alreadyRegistered?: boolean;

  releasedPokemon?: {
    id?: number;
    pokemonId?: number;
    name?: string;
  } | null;

  summary?: {
    all?: CollectionSummaryItem;
    pokemon?: CollectionSummaryItem;
    trainer?: CollectionSummaryItem;
    energy?: CollectionSummaryItem;
    stadium?: CollectionSummaryItem;
  };

  collection?:
    | CollectionCategory
    | "all";
};

/* =========================================================
   HELPERS
========================================================= */

function getPokemonId(
  item: RegisteredPokemon
) {
  return (
    item.pokemonId ??
    item.pokemon_id ??
    item.id
  );
}

function getDexNumber(
  item: RegisteredPokemon
) {
  return (
    item.nationalDexNumber ??
    item.national_dex_number ??
    0
  );
}

function pokemonImage(
  item: RegisteredPokemon
) {
  if (item.image) {
    return item.image;
  }

  const dex =
    String(
      getDexNumber(item)
    ).padStart(
      3,
      "0"
    );

  if (
    getDexNumber(item) >
    0
  ) {
    return `https://assets.pokemon.com/assets/cms2/img/pokedex/full/${dex}.png`;
  }

  return null;
}

function pokemonAnimatedImage(
  item: RegisteredPokemon
) {
  const dex = getDexNumber(item);

  if (dex > 0) {
    return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${dex}.gif`;
  }

  return pokemonImage(item);
}

function cardImage(
  card: SearchCard
) {
  return (
    card.image ||
    card.directImage ||
    card.imageCandidates?.find(
      Boolean
    ) ||
    null
  );
}

function cardUsd(
  card: SearchCard
) {
  return (
    card.prices?.usd ??
    card.priceUsd ??
    null
  );
}

function cardBrl(
  card: SearchCard
) {
  return (
    card.prices?.brl ??
    card.priceBrl ??
    null
  );
}

function cardEur(
  card: SearchCard
) {
  return (
    card.prices?.eur ??
    card.priceEur ??
    null
  );
}

function getOwnedQuantity(
  card: SearchCard
) {
  if (
    typeof card.ownedQuantity ===
      "number" &&
    Number.isFinite(
      card.ownedQuantity
    )
  ) {
    return Math.max(
      0,
      Math.floor(
        card.ownedQuantity
      )
    );
  }

  if (
    typeof card.ownedCard
      ?.quantity ===
      "number" &&
    Number.isFinite(
      card.ownedCard.quantity
    )
  ) {
    return Math.max(
      0,
      Math.floor(
        card.ownedCard.quantity
      )
    );
  }

  return card.owned
    ? 1
    : 0;
}

function isCardOwned(
  card: SearchCard
) {
  return (
    getOwnedQuantity(
      card
    ) > 0
  );
}

function money(
  value:
    | number
    | null
    | undefined,
  currency:
    | "USD"
    | "BRL"
    | "EUR"
) {
  if (
    typeof value !==
      "number" ||
    !Number.isFinite(
      value
    )
  ) {
    return "Não disponível";
  }

  return new Intl.NumberFormat(
    "pt-BR",
    {
      style:
        "currency",
      currency,
      minimumFractionDigits:
        2,
      maximumFractionDigits:
        2,
    }
  ).format(
    value
  );
}

function hasValidPrice(
  value:
    | number
    | null
    | undefined
) {
  return (
    typeof value ===
      "number" &&
    Number.isFinite(
      value
    ) &&
    value > 0
  );
}

function parseBrlInput(
  value: string
) {
  const normalized =
    value
      .replace(
        /R\$/gi,
        ""
      )
      .replace(
        /\s/g,
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
      .trim();

  if (
    !normalized
  ) {
    return null;
  }

  const number =
    Number(
      normalized
    );

  if (
    !Number.isFinite(
      number
    ) ||
    number <= 0
  ) {
    return null;
  }

  return number;
}

function collectionPercentage(
  ownedCount: number,
  totalCards: number
) {
  if (
    totalCards <= 0
  ) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(
      (ownedCount /
        totalCards) *
        100
    )
  );
}

function getCardCategory(
  card: SearchCard
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

function categoryIcon(
  category: CollectionCategory
) {
  switch (
    category
  ) {
    case "pokemon":
      return "◈";

    case "trainer":
      return "▣";

    case "energy":
      return "✦";

    case "stadium":
      return "▤";
  }
}

/* =========================================================
   MOVIMENTO VISUAL UNIVERSAL DOS POKÉMON
========================================================= */

const POKEMON_MOTION_STYLE = `
@keyframes pokescanPokemonFloat {
  0%, 100% { transform: translate3d(0, 0, 0) rotate(-1deg) scale(1); }
  25% { transform: translate3d(-2px, -5px, 0) rotate(0deg) scale(1.012); }
  50% { transform: translate3d(1px, -2px, 0) rotate(1deg) scale(1.02); }
  75% { transform: translate3d(2px, -6px, 0) rotate(0deg) scale(1.012); }
}
.pokescan-pokemon-motion {
  animation: pokescanPokemonFloat 2.6s ease-in-out infinite;
  transform-origin: 50% 80%;
  will-change: transform;
}
@media (prefers-reduced-motion: reduce) {
  .pokescan-pokemon-motion { animation: none; }
}
`;

/* =========================================================
   COMPONENT
========================================================= */

export default function PokedexPage() {
  const router =
    useRouter();

  /* =======================================================
     POKEDEX
  ======================================================= */

  const [
    registered,
    setRegistered,
  ] =
    useState<
      RegisteredPokemon[]
    >([]);

  const [
    loading,
    setLoading,
  ] =
    useState(true);

  const [
    error,
    setError,
  ] =
    useState("");

  /* =======================================================
     SEARCH
  ======================================================= */

  const [
    search,
    setSearch,
  ] =
    useState("");

  const [
    searchLoading,
    setSearchLoading,
  ] =
    useState(false);

  const [
    searchError,
    setSearchError,
  ] =
    useState("");

  const [
    searchCards,
    setSearchCards,
  ] =
    useState<
      SearchCard[]
    >([]);

  const [
    searchedName,
    setSearchedName,
  ] =
    useState("");

  const [
    searchExecuted,
    setSearchExecuted,
  ] =
    useState(false);

  const [
    activeCategory,
    setActiveCategory,
  ] =
    useState<
      "all" |
      CollectionCategory
    >(
      "all"
    );

  /* =======================================================
     PASTAS DA COLEÇÃO
  ======================================================= */

  const [
    openCollection,
    setOpenCollection,
  ] =
    useState<
      CollectionCategory |
      null
    >(null);

  const [
    collectionCards,
    setCollectionCards,
  ] =
    useState<
      SearchCard[]
    >([]);

  const [
    collectionLoading,
    setCollectionLoading,
  ] =
    useState(false);

  const [
    collectionError,
    setCollectionError,
  ] =
    useState("");

  const [
    collectionSummary,
    setCollectionSummary,
  ] =
    useState<{
      all: CollectionSummaryItem;
      pokemon: CollectionSummaryItem;
      trainer: CollectionSummaryItem;
      energy: CollectionSummaryItem;
      stadium: CollectionSummaryItem;
    }>({
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
    });

  /* =======================================================
     CARTA SELECIONADA
  ======================================================= */

  const [
    selectedCard,
    setSelectedCard,
  ] =
    useState<
      SearchCard | null
    >(null);

  /* =======================================================
     TROCA
  ======================================================= */

  const [tradingCard, setTradingCard] =
    useState<SearchCard | null>(null);

  const [tradeQuantity, setTradeQuantity] =
    useState(1);

  const [tradeSaving, setTradeSaving] =
    useState(false);

  const [tradeError, setTradeError] =
    useState("");

  const [tradeMessage, setTradeMessage] =
    useState("");

  /* =======================================================
     SELECTED POKEMON
  ======================================================= */

  const [
    selected,
    setSelected,
  ] =
    useState<
      RegisteredPokemon | null
    >(null);

  const [
    registeredCards,
    setRegisteredCards,
  ] =
    useState<
      SearchCard[]
    >([]);

  const [
    registeredCardsLoading,
    setRegisteredCardsLoading,
  ] =
    useState(false);

  const [
    registeredCardsError,
    setRegisteredCardsError,
  ] =
    useState("");

  const [
    selectedOwnedCount,
    setSelectedOwnedCount,
  ] =
    useState(0);

  const [
    selectedOwnedQuantity,
    setSelectedOwnedQuantity,
  ] =
    useState(0);

  const [
    selectedTotalCount,
    setSelectedTotalCount,
  ] =
    useState(0);

  /* =======================================================
     PRICE EDITOR
  ======================================================= */

  const [
    editingCardId,
    setEditingCardId,
  ] =
    useState<
      string | null
    >(null);

  const [
    priceInput,
    setPriceInput,
  ] =
    useState("");

  const [
    priceSourceInput,
    setPriceSourceInput,
  ] =
    useState(
      "Mercado brasileiro"
    );

  const [
    priceNoteInput,
    setPriceNoteInput,
  ] =
    useState("");

  const [
    priceSaving,
    setPriceSaving,
  ] =
    useState(false);

  const [
    priceError,
    setPriceError,
  ] =
    useState("");

  const [
    priceSuccess,
    setPriceSuccess,
  ] =
    useState("");

  /* =======================================================
     OWNED
  ======================================================= */

  const [
    ownedSavingCardId,
    setOwnedSavingCardId,
  ] =
    useState<
      string | null
    >(null);

  const [
    ownedError,
    setOwnedError,
  ] =
    useState("");

  const [
    collectionMessage,
    setCollectionMessage,
  ] =
    useState("");

  /* =======================================================
     PARSE
  ======================================================= */

  async function parseJson(
    response: Response
  ): Promise<PokedexResponse> {
    const raw =
      await response.text();

    try {
      return JSON.parse(
        raw
      ) as PokedexResponse;
    } catch {
      throw new Error(
        "A API da Pokédex retornou uma resposta inválida."
      );
    }
  }

  /* =======================================================
     ATUALIZA CARTA EM TODAS AS LISTAS
  ======================================================= */

  function updateCardInLists(
    cardId: string,
    updater: (
      card: SearchCard
    ) => SearchCard
  ) {
    setSearchCards(
      (
        current
      ) =>
        current.map(
          (
            card
          ) =>
            card.id ===
            cardId
              ? updater(
                  card
                )
              : card
        )
    );

    setRegisteredCards(
      (
        current
      ) =>
        current.map(
          (
            card
          ) =>
            card.id ===
            cardId
              ? updater(
                  card
                )
              : card
        )
    );

    setCollectionCards(
      (
        current
      ) =>
        current.map(
          (
            card
          ) =>
            card.id ===
            cardId
              ? updater(
                  card
                )
              : card
        )
    );

    setSelectedCard(
      (
        current
      ) =>
        current?.id ===
        cardId
          ? updater(
              current
            )
          : current
    );
  }

  /* =======================================================
     ATUALIZA QUANTIDADE
  ======================================================= */

  function applyOwnedQuantity(
    cardId: string,
    quantity: number
  ) {
    const safeQuantity =
      Math.max(
        0,
        Math.floor(
          quantity
        )
      );

    updateCardInLists(
      cardId,
      (
        item
      ) => ({
        ...item,

        owned:
          safeQuantity >
          0,

        ownedQuantity:
          safeQuantity,

        ownedCard:
          safeQuantity >
          0
            ? {
                ...(
                  item.ownedCard ||
                  {}
                ),

                cardId:
                  item.id,

                cardName:
                  item.name,

                setId:
                  item.set
                    ?.id ??
                  null,

                setName:
                  item.set
                    ?.name ??
                  null,

                cardNumber:
                  item.number ??
                  null,

                quantity:
                  safeQuantity,
              }
            : null,
      })
    );
  }

  /* =======================================================
     ATUALIZA RESUMO DAS PASTAS LOCALMENTE
  ======================================================= */

  function updateCollectionSummaryLocal(
    card: SearchCard,
    oldQuantity: number,
    newQuantity: number
  ) {
    const category =
      getCardCategory(
        card
      );

    const modelDelta =
      oldQuantity <= 0 &&
      newQuantity > 0
        ? 1
        : oldQuantity > 0 &&
            newQuantity <= 0
          ? -1
          : 0;

    const quantityDelta =
      newQuantity -
      oldQuantity;

    setCollectionSummary(
      (
        current
      ) => ({
        ...current,

        [category]: {
          models:
            Math.max(
              0,
              current[
                category
              ].models +
                modelDelta
            ),

          quantity:
            Math.max(
              0,
              current[
                category
              ].quantity +
                quantityDelta
            ),
        },

        all: {
          models:
            Math.max(
              0,
              current.all.models +
                modelDelta
            ),

          quantity:
            Math.max(
              0,
              current.all.quantity +
                quantityDelta
            ),
        },
      })
    );
  }

  /* =======================================================
     LOAD REGISTERED
  ======================================================= */

  async function loadRegistered() {
    try {
      setLoading(
        true
      );

      setError(
        ""
      );

      const response =
        await fetch(
          "/api/pokedex",
          {
            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível carregar a Pokédex."
        );
      }

      setRegistered(
        data.entries ||
          data.pokemon ||
          []
      );
    } catch (
      err
    ) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar a Pokédex."
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  /* =======================================================
     LOAD COLLECTION SUMMARY
  ======================================================= */

  async function loadCollectionSummary() {
    try {
      const response =
        await fetch(
          "/api/pokedex?collection=all",
          {
            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        return;
      }

      if (
        data.summary
      ) {
        setCollectionSummary(
          (
            current
          ) => ({
            all:
              data.summary
                ?.all ??
              current.all,

            pokemon:
              data.summary
                ?.pokemon ??
              current.pokemon,

            trainer:
              data.summary
                ?.trainer ??
              current.trainer,

            energy:
              data.summary
                ?.energy ??
              current.energy,

            stadium:
              data.summary
                ?.stadium ??
              current.stadium,
          })
        );
      }
    } catch {
      /*
       * O resumo não impede
       * o restante da página
       * de funcionar.
       */
    }
  }

  /* =======================================================
     ABRIR PASTA DA COLEÇÃO
  ======================================================= */

  async function openCollectionFolder(
    category: CollectionCategory
  ) {
    if (
      openCollection ===
      category
    ) {
      setOpenCollection(
        null
      );

      setCollectionCards(
        []
      );

      return;
    }

    try {
      setOpenCollection(
        category
      );

      setCollectionLoading(
        true
      );

      setCollectionError(
        ""
      );

      setCollectionCards(
        []
      );

      setPriceError(
        ""
      );

      setPriceSuccess(
        ""
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      const response =
        await fetch(
          `/api/pokedex?collection=${encodeURIComponent(
            category
          )}`,
          {
            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível carregar a pasta."
        );
      }

      const cards =
        Array.isArray(
          data.cards
        )
          ? data.cards
          : Array.isArray(
                data.entries
              )
            ? data.entries
            : [];

      setCollectionCards(
        cards
      );

      if (
        data.summary
      ) {
        setCollectionSummary(
          (
            current
          ) => ({
            all:
              data.summary
                ?.all ??
              current.all,

            pokemon:
              data.summary
                ?.pokemon ??
              current.pokemon,

            trainer:
              data.summary
                ?.trainer ??
              current.trainer,

            energy:
              data.summary
                ?.energy ??
              current.energy,

            stadium:
              data.summary
                ?.stadium ??
              current.stadium,
          })
        );
      }

      setTimeout(
        () => {
          document
            .getElementById(
              `collection-${category}`
            )
            ?.scrollIntoView({
              behavior:
                "smooth",
              block:
                "start",
            });
        },
        50
      );
    } catch (
      err
    ) {
      setCollectionError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar a coleção."
      );
    } finally {
      setCollectionLoading(
        false
      );
    }
  }

  /* =======================================================
     PRICE
  ======================================================= */

  function openPriceEditor(
    card: SearchCard
  ) {
    setEditingCardId(
      card.id
    );

    const currentBrl =
      cardBrl(
        card
      );

    setPriceInput(
      hasValidPrice(
        currentBrl
      )
        ? currentBrl!
            .toFixed(
              2
            )
            .replace(
              ".",
              ","
            )
        : ""
    );

    setPriceSourceInput(
      card.manualPrice
        ?.source ||
        "Mercado brasileiro"
    );

    setPriceNoteInput(
      card.manualPrice
        ?.note ||
        ""
    );

    setPriceError(
      ""
    );

    setPriceSuccess(
      ""
    );
  }

  function closePriceEditor() {
    if (
      priceSaving
    ) {
      return;
    }

    setEditingCardId(
      null
    );

    setPriceError(
      ""
    );
  }

  function applyPriceToCard(
    card: SearchCard,
    brl: number,
    source: string,
    note: string
  ): SearchCard {
    return {
      ...card,

      priceBrl:
        brl,

      prices: {
        ...(
          card.prices ||
          {}
        ),

        brl,
      },

      manualPrice: {
        cardId:
          card.id,

        brl,

        usd:
          cardUsd(
            card
          ),

        source,

        note:
          note ||
          null,
      },

      isManualPrice:
        true,

      priceIsLocal:
        true,

      priceSource:
        source,

      priceNote:
        note ||
        "Preço informado manualmente em BRL.",
    };
  }

  async function saveManualPrice(
    card: SearchCard
  ) {
    const brl =
      parseBrlInput(
        priceInput
      );

    if (
      brl ===
      null
    ) {
      setPriceError(
        "Digite um valor válido em BRL. Exemplo: 0,13"
      );

      return;
    }

    try {
      setPriceSaving(
        true
      );

      setPriceError(
        ""
      );

      setPriceSuccess(
        ""
      );

      const source =
        priceSourceInput.trim() ||
        "Mercado brasileiro";

      const note =
        priceNoteInput.trim();

      const response =
        await fetch(
          "/api/pokedex",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "setPrice",

                cardId:
                  card.id,

                brl,

                source,

                note,
              }),
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível salvar o preço."
        );
      }

      updateCardInLists(
        card.id,
        (
          item
        ) =>
          applyPriceToCard(
            item,
            brl,
            source,
            note
          )
      );

      setPriceSuccess(
        `Preço salvo: ${money(
          brl,
          "BRL"
        )}`
      );

      setEditingCardId(
        null
      );
    } catch (
      err
    ) {
      setPriceError(
        err instanceof Error
          ? err.message
          : "Erro ao salvar o preço."
      );
    } finally {
      setPriceSaving(
        false
      );
    }
  }

  async function removeManualPrice(
    card: SearchCard
  ) {
    if (
      !window.confirm(
        "Remover o preço manual desta impressão?"
      )
    ) {
      return;
    }

    try {
      setPriceSaving(
        true
      );

      setPriceError(
        ""
      );

      const response =
        await fetch(
          "/api/pokedex",
          {
            method:
              "DELETE",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "deletePrice",

                cardId:
                  card.id,
              }),
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível remover o preço manual."
        );
      }

      updateCardInLists(
        card.id,
        (
          item
        ) => ({
          ...item,

          manualPrice:
            null,

          isManualPrice:
            false,

          priceBrl:
            null,

          prices: {
            ...(
              item.prices ||
              {}
            ),

            brl:
              null,
          },

          priceNote:
            null,

          priceSource:
            null,
        })
      );

      setPriceSuccess(
        "Preço manual removido."
      );
    } catch (
      err
    ) {
      setPriceError(
        err instanceof Error
          ? err.message
          : "Erro ao remover o preço."
      );
    } finally {
      setPriceSaving(
        false
      );
    }
  }

  /* =======================================================
     MARCAR COMO TENHO
  ======================================================= */

  async function toggleOwnedCard(
    card: SearchCard
  ) {
    const oldQuantity =
      getOwnedQuantity(
        card
      );

    const newOwned =
      !isCardOwned(
        card
      );

    try {
      setOwnedSavingCardId(
        card.id
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      const response =
        await fetch(
          "/api/pokedex",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "setOwned",

                cardId:
                  card.id,

                owned:
                  newOwned,
              }),
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível atualizar a coleção."
        );
      }

      const quantity =
        typeof data.quantity ===
          "number"
          ? data.quantity
          : newOwned
            ? 1
            : 0;

      applyOwnedQuantity(
        card.id,
        quantity
      );

      updateCollectionSummaryLocal(
        card,
        oldQuantity,
        quantity
      );

      const updatedRegistered =
        registeredCards.map(
          (
            item
          ) =>
            item.id ===
            card.id
              ? {
                  ...item,

                  owned:
                    quantity >
                    0,

                  ownedQuantity:
                    quantity,
                }
              : item
        );

      setRegisteredCards(
        updatedRegistered
      );

      setSelectedTotalCount(
        updatedRegistered.length
      );

      setSelectedOwnedCount(
        updatedRegistered.filter(
          isCardOwned
        ).length
      );

      setSelectedOwnedQuantity(
        updatedRegistered.reduce(
          (
            total,
            item
          ) =>
            total +
            getOwnedQuantity(
              item
            ),
          0
        )
      );

      if (
        newOwned &&
        data.autoRegisteredPokemon
      ) {
        const autoPokemon =
          data.autoRegisteredPokemon;

        setCollectionMessage(
          `${autoPokemon.name} foi adicionado automaticamente à sua Pokédex.`
        );

        await loadRegistered();
      } else if (
        newOwned &&
        data.alreadyRegistered
      ) {
        setCollectionMessage(
          `Carta adicionada à sua coleção. Você possui ${quantity} unidade(s).`
        );
      } else if (
        newOwned
      ) {
        setCollectionMessage(
          `Carta adicionada à sua coleção. Você possui ${quantity} unidade(s).`
        );
      } else {
        setCollectionMessage(
          "Carta removida da sua coleção."
        );
      }
    } catch (
      err
    ) {
      setOwnedError(
        err instanceof Error
          ? err.message
          : "Erro ao atualizar a coleção."
      );
    } finally {
      setOwnedSavingCardId(
        null
      );
    }
  }

  /* =======================================================
     +1
  ======================================================= */

  async function addOwnedUnit(
    card: SearchCard
  ) {
    const oldQuantity =
      getOwnedQuantity(
        card
      );

    try {
      setOwnedSavingCardId(
        card.id
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      const response =
        await fetch(
          "/api/pokedex",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "addOwned",

                cardId:
                  card.id,
              }),
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível adicionar a unidade."
        );
      }

      const quantity =
        typeof data.quantity ===
          "number"
          ? data.quantity
          : oldQuantity +
            1;

      applyOwnedQuantity(
        card.id,
        quantity
      );

      updateCollectionSummaryLocal(
        card,
        oldQuantity,
        quantity
      );

      const updated =
        registeredCards.map(
          (
            item
          ) =>
            item.id ===
            card.id
              ? {
                  ...item,

                  owned:
                    true,

                  ownedQuantity:
                    quantity,
                }
              : item
        );

      setRegisteredCards(
        updated
      );

      setSelectedTotalCount(
        updated.length
      );

      setSelectedOwnedCount(
        updated.filter(
          isCardOwned
        ).length
      );

      setSelectedOwnedQuantity(
        updated.reduce(
          (
            total,
            item
          ) =>
            total +
            getOwnedQuantity(
              item
            ),
          0
        )
      );

      setCollectionMessage(
        `Você possui ${quantity} unidade(s) desta carta.`
      );
    } catch (
      err
    ) {
      setOwnedError(
        err instanceof Error
          ? err.message
          : "Erro ao adicionar unidade."
      );
    } finally {
      setOwnedSavingCardId(
        null
      );
    }
  }

  /* =======================================================
     -1
  ======================================================= */

  async function removeOwnedUnit(
    card: SearchCard
  ) {
    const oldQuantity =
      getOwnedQuantity(
        card
      );

    if (
      oldQuantity <=
      0
    ) {
      return;
    }

    try {
      setOwnedSavingCardId(
        card.id
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      const response =
        await fetch(
          "/api/pokedex",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json",
            },

            body:
              JSON.stringify({
                action:
                  "removeOwned",

                cardId:
                  card.id,
              }),
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível remover a unidade."
        );
      }

      const quantity =
        typeof data.quantity ===
          "number"
          ? data.quantity
          : Math.max(
              0,
              oldQuantity -
                1
            );

      applyOwnedQuantity(
        card.id,
        quantity
      );

      updateCollectionSummaryLocal(
        card,
        oldQuantity,
        quantity
      );

      const updated =
        registeredCards.map(
          (
            item
          ) =>
            item.id ===
            card.id
              ? {
                  ...item,

                  owned:
                    quantity >
                    0,

                  ownedQuantity:
                    quantity,
                }
              : item
        );

      setRegisteredCards(
        updated
      );

      setSelectedTotalCount(
        updated.length
      );

      setSelectedOwnedCount(
        updated.filter(
          isCardOwned
        ).length
      );

      setSelectedOwnedQuantity(
        updated.reduce(
          (
            total,
            item
          ) =>
            total +
            getOwnedQuantity(
              item
            ),
          0
        )
      );

      if (
        quantity ===
        0
      ) {
        setCollectionMessage(
          "A última unidade foi removida da sua coleção."
        );
      } else {
        setCollectionMessage(
          `Agora você possui ${quantity} unidade(s) desta carta.`
        );
      }

      if (
        quantity ===
        0
      ) {
        setCollectionCards(
          (
            current
          ) =>
            current.filter(
              (
                item
              ) =>
                item.id !==
                card.id
            )
        );
      }
    } catch (
      err
    ) {
      setOwnedError(
        err instanceof Error
          ? err.message
          : "Erro ao remover unidade."
      );
    } finally {
      setOwnedSavingCardId(
        null
      );
    }
  }

  /* =======================================================
     TROCA / LIBERAÇÃO
  ======================================================= */

  async function tradeOwnedCard(card: SearchCard) {
    const available = getOwnedQuantity(card);

    if (available <= 0) {
      return;
    }

    const quantity = Math.max(
      1,
      Math.min(
        available,
        Math.floor(tradeQuantity) || 1
      )
    );

    try {
      setTradeSaving(true);
      setTradeError("");
      setTradeMessage("");

      const response = await fetch("/api/pokedex", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          action: "tradeOwned",
          cardId: card.id,
          quantity,
        }),
      });

      const data = await parseJson(response);

      if (!response.ok || !data.success) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível registrar a troca."
        );
      }

      const nextQuantity = Number(
        data.quantity ??
          Math.max(0, available - quantity)
      );

      applyOwnedQuantity(card.id, nextQuantity);
      updateCollectionSummaryLocal(
        card,
        available,
        nextQuantity
      );

      setCollectionCards(current =>
        nextQuantity <= 0
          ? current.filter(item => item.id !== card.id)
          : current
      );

      setSearchCards(current =>
        current.map(item =>
          item.id === card.id
            ? {
                ...item,
                owned: nextQuantity > 0,
                ownedQuantity: nextQuantity,
              }
            : item
        )
      );

      const released =
        data.releasedPokemon || null;

      if (released) {
        await loadRegistered();

        if (
          selected &&
          getPokemonId(selected) ===
            Number(released.pokemonId)
        ) {
          setSelected(null);
          setRegisteredCards([]);
          setSelectedOwnedCount(0);
          setSelectedOwnedQuantity(0);
          setSelectedTotalCount(0);
        }
      }

      setTradeMessage(
        data.message ||
          (released
            ? `${quantity} unidade(s) trocada(s). ${released.name || "Pokémon"} foi liberado da Pokédex.`
            : `${quantity} unidade(s) trocada(s).`)
      );

      setTradingCard(null);
      setTradeQuantity(1);
    } catch (err) {
      setTradeError(
        err instanceof Error
          ? err.message
          : "Erro ao registrar a troca."
      );
    } finally {
      setTradeSaving(false);
    }
  }

  /* =======================================================
     PRICE EDITOR UI
  ======================================================= */

  function renderPriceEditor(
    card: SearchCard
  ) {
    if (
      editingCardId !==
      card.id
    ) {
      return null;
    }

    return (
      <div
        onClick={(event) =>
          event.stopPropagation()
        }
        className="mt-3 rounded-2xl border border-blue-400/20 bg-blue-500/[0.04] p-3"
      >
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[9px] font-black uppercase tracking-widest text-blue-300">
              Editar preço
            </p>

            <p className="mt-1 break-words text-[10px] leading-4 text-slate-500">
              O valor será salvo somente para esta impressão.
            </p>
          </div>

          <button
            type="button"
            onClick={
              closePriceEditor
            }
            disabled={
              priceSaving
            }
            className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            ×
          </button>
        </div>

        <div className="mt-3 space-y-2">
          <div>
            <label
              htmlFor={`price-${card.id}`}
              className="text-[10px] font-bold text-slate-400"
            >
              Valor em BRL
            </label>

            <input
              id={`price-${card.id}`}
              value={
                priceInput
              }
              onChange={(
                event
              ) =>
                setPriceInput(
                  event.target
                    .value
                )
              }
              placeholder="Ex.: 0,13"
              inputMode="decimal"
              disabled={
                priceSaving
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070d] px-3 py-2.5 text-sm text-white outline-none transition focus:border-blue-400/50"
            />
          </div>

          <div>
            <label
              htmlFor={`source-${card.id}`}
              className="text-[10px] font-bold text-slate-400"
            >
              Fonte
            </label>

            <input
              id={`source-${card.id}`}
              value={
                priceSourceInput
              }
              onChange={(
                event
              ) =>
                setPriceSourceInput(
                  event.target
                    .value
                )
              }
              disabled={
                priceSaving
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070d] px-3 py-2.5 text-xs text-white outline-none transition focus:border-blue-400/50"
            />
          </div>

          <div>
            <label
              htmlFor={`note-${card.id}`}
              className="text-[10px] font-bold text-slate-400"
            >
              Observação
            </label>

            <input
              id={`note-${card.id}`}
              value={
                priceNoteInput
              }
              onChange={(
                event
              ) =>
                setPriceNoteInput(
                  event.target
                    .value
                )
              }
              placeholder="Ex.: R$ 0,10–R$ 0,15"
              disabled={
                priceSaving
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-[#05070d] px-3 py-2.5 text-xs text-white outline-none transition focus:border-blue-400/50"
            />
          </div>

          {priceError && (
            <div className="break-words rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[10px] leading-4 text-red-300">
              {
                priceError
              }
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              void saveManualPrice(
                card
              )
            }
            disabled={
              priceSaving
            }
            className="w-full rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-black text-white transition hover:bg-blue-400 disabled:opacity-60"
          >
            {priceSaving
              ? "Salvando..."
              : "Salvar preço"}
          </button>
        </div>
      </div>
    );
  }

  /* =======================================================
     RENDER CARD
  ======================================================= */

  function renderCard(
    card: SearchCard,
    compact = false
  ) {
    const image =
      cardImage(
        card
      );

    const usd =
      cardUsd(
        card
      );

    const brl =
      cardBrl(
        card
      );

    const eur =
      cardEur(
        card
      );

    const owned =
      isCardOwned(
        card
      );

    const quantity =
      getOwnedQuantity(
        card
      );

    const saving =
      ownedSavingCardId ===
      card.id;

    const hasAnyPrice =
      hasValidPrice(
        usd
      ) ||
      hasValidPrice(
        brl
      ) ||
      hasValidPrice(
        eur
      );

    const category =
      getCardCategory(
        card
      );

    return (
      <article
        key={
          card.id
        }
        className={`group min-w-0 overflow-hidden rounded-[1.5rem] border bg-[#07090f] shadow-2xl transition duration-300 ${
          owned
            ? "border-blue-400/45 shadow-blue-500/10"
            : editingCardId ===
                card.id
              ? "border-blue-400/60"
              : "border-white/10 hover:-translate-y-1 hover:border-blue-400/35"
        }`}
      >
        {/* =================================================
            CARD VISUAL
        ================================================= */}

        <button
          type="button"
          onClick={() =>
            setSelectedCard(
              card
            )
          }
          className="block w-full text-left"
        >
          <div
            className={`relative flex items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.13),transparent_65%)] p-3 ${
              compact
                ? "h-64 sm:h-72"
                : "h-[330px] sm:h-[360px]"
            }`}
          >
            {image ? (
              <img
                src={
                  image
                }
                alt={`${card.name} ${
                  card
                    .set
                    ?.name ||
                  ""
                }`}
                className="max-h-full max-w-full object-contain drop-shadow-[0_25px_45px_rgba(0,0,0,0.55)] transition duration-300 group-hover:scale-[1.025]"
                loading="lazy"
                onError={(
                  event
                ) => {
                  const current =
                    event
                      .currentTarget
                      .src;

                  const alternatives =
                    (
                      card.imageCandidates ||
                      []
                    ).filter(
                      (
                        candidate
                      ) =>
                        candidate &&
                        candidate !==
                          current
                    );

                  if (
                    alternatives.length >
                    0
                  ) {
                    event.currentTarget.src =
                      alternatives[0] as string;
                  } else {
                    event.currentTarget.style.display =
                      "none";
                  }
                }}
              />
            ) : (
              <div className="text-center text-sm text-slate-500">
                <div className="text-4xl">
                  🖼️
                </div>

                <p className="mt-2">
                  Imagem indisponível
                </p>
              </div>
            )}

            <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/65 px-2.5 py-1.5 text-[9px] font-black text-slate-200 backdrop-blur">
              {
                categoryIcon(
                  category
                )
              }{" "}
              {
                categoryLabel(
                  category
                )
              }
            </span>

            <span className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/65 px-2.5 py-1.5 text-[9px] font-black text-slate-200 backdrop-blur">
              #
              {
                card.number ||
                "—"
              }
            </span>

            {owned && (
              <span className="absolute bottom-3 left-3 rounded-full border border-blue-400/35 bg-blue-500/20 px-3 py-1.5 text-[9px] font-black text-blue-200 backdrop-blur">
                ✓ NA COLEÇÃO
                {quantity >
                1
                  ? ` ${quantity}x`
                  : ""}
              </span>
            )}

            <span className="absolute bottom-3 right-3 rounded-full border border-white/10 bg-black/65 px-3 py-1.5 text-[9px] font-black text-slate-300 backdrop-blur opacity-0 transition group-hover:opacity-100">
              Ver detalhes
            </span>
          </div>
        </button>

        {/* =================================================
            INFO
        ================================================= */}

        <div className="min-w-0 border-t border-white/10 p-4">
          <button
            type="button"
            onClick={() =>
              setSelectedCard(
                card
              )
            }
            className="block w-full text-left"
          >
            <div className="flex min-w-0 items-center justify-between gap-3">
              <p className="truncate text-[9px] font-black uppercase tracking-[0.2em] text-blue-400/80">
                {
                  categoryLabel(
                    category
                  )
                }
              </p>

              <div className="flex shrink-0 items-center gap-1.5">
                {card.isManualPrice && (
                  <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[9px] font-black text-blue-300">
                    Manual
                  </span>
                )}

                {owned && (
                  <span className="rounded-full bg-blue-500/15 px-2 py-1 text-[9px] font-black text-blue-300">
                    ✓
                  </span>
                )}
              </div>
            </div>

            <h4 className="mt-1 line-clamp-2 break-words text-lg font-black leading-tight text-white transition group-hover:text-blue-200">
              {
                card.name
              }
            </h4>

            <p className="mt-1 line-clamp-2 break-words text-xs font-semibold leading-5 text-slate-500">
              {
                card
                  .set
                  ?.name ||
                "Coleção não informada"
              }
            </p>
          </button>

          {/* META */}

          <div className="mt-3 grid min-w-0 grid-cols-2 gap-2">
            <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.025] p-2.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                Raridade
              </p>

              <p className="mt-1 break-words text-xs font-bold text-slate-300">
                {
                  card.rarity ||
                  "Não informada"
                }
              </p>
            </div>

            <div className="min-w-0 rounded-xl border border-white/5 bg-white/[0.025] p-2.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                Número
              </p>

              <p className="mt-1 text-xs font-bold text-slate-300">
                #
                {
                  card.number ||
                  "—"
                }
              </p>
            </div>
          </div>

          {/* PREÇOS */}

          <div className="mt-3 rounded-2xl border border-white/5 bg-black/30 p-3">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                Valor de mercado
              </p>

              {card.isManualPrice ? (
                <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-1 text-[9px] font-black text-blue-300">
                  Manual
                </span>
              ) : hasAnyPrice ? (
                <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-black text-blue-300">
                  Atual
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-white/5 px-2 py-1 text-[9px] font-black text-slate-500">
                  Sem preço
                </span>
              )}
            </div>

            <div className="grid min-w-0 grid-cols-3 gap-2">
              <div className="min-w-0 rounded-xl border border-blue-400/10 bg-blue-500/10 p-2">
                <p className="text-[8px] font-black uppercase tracking-wider text-blue-300/60">
                  USD
                </p>

                <p className="mt-1 break-words text-xs font-black leading-tight text-blue-200">
                  {money(
                    usd,
                    "USD"
                  )}
                </p>
              </div>

              <div className="min-w-0 rounded-xl bg-white/[0.035] p-2">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-600">
                  BRL
                </p>

                <p className="mt-1 break-words text-xs font-black leading-tight text-white">
                  {money(
                    brl,
                    "BRL"
                  )}
                </p>
              </div>

              <div className="min-w-0 rounded-xl bg-white/[0.035] p-2">
                <p className="text-[8px] font-black uppercase tracking-wider text-slate-600">
                  EUR
                </p>

                <p className="mt-1 break-words text-xs font-black leading-tight text-white">
                  {money(
                    eur,
                    "EUR"
                  )}
                </p>
              </div>
            </div>

            {card.isManualPrice &&
              card.manualPrice && (
                <div className="mt-3 rounded-xl border border-blue-400/10 bg-blue-500/[0.04] px-3 py-2">
                  <p className="break-words text-[10px] leading-4 text-blue-100/70">
                    ✎{" "}
                    {
                      card
                        .manualPrice
                        .source ||
                      "Preço manual"
                    }

                    {card
                      .manualPrice
                      .note
                      ? ` · ${card.manualPrice.note}`
                      : ""}
                  </p>
                </div>
              )}

            {!hasAnyPrice &&
              !card.isManualPrice && (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 px-3 py-2.5">
                  <p className="break-words text-[10px] leading-4 text-slate-600">
                    ℹ️ O preço desta impressão ainda não foi encontrado.
                  </p>
                </div>
              )}

            {/* COLEÇÃO */}

            <div className="mt-3 rounded-2xl border border-blue-400/10 bg-blue-500/[0.035] p-3">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                    Minha coleção
                  </p>

                  <p className="mt-1 break-words text-sm font-black text-white">
                    {owned
                      ? quantity ===
                        1
                        ? "Tenho 1 unidade"
                        : `Tenho ${quantity} unidades`
                      : "Ainda não tenho"}
                  </p>
                </div>

                {!owned ? (
                  <button
                    type="button"
                    onClick={(
                      event
                    ) => {
                      event.stopPropagation();

                      void toggleOwnedCard(
                        card
                      );
                    }}
                    disabled={
                      saving
                    }
                    className="w-full rounded-xl bg-blue-500 px-3 py-2.5 text-[10px] font-black text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {saving
                      ? "Salvando..."
                      : "+ Adicionar à coleção"}
                  </button>
                ) : (
                  <div className="flex w-full items-center justify-center">
                    <div className="flex items-center gap-1 rounded-2xl border border-blue-400/20 bg-black/25 p-1.5">
                      <button
                        type="button"
                        onClick={(
                          event
                        ) => {
                          event.stopPropagation();

                          void removeOwnedUnit(
                            card
                          );
                        }}
                        disabled={
                          saving
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-slate-300 transition hover:bg-red-500/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        −
                      </button>

                      <div className="flex h-9 min-w-12 items-center justify-center rounded-xl bg-white/[0.04] px-3">
                        <span className="text-sm font-black text-blue-300">
                          {saving
                            ? "..."
                            : quantity}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={(
                          event
                        ) => {
                          event.stopPropagation();

                          void addOwnedUnit(
                            card
                          );
                        }}
                        disabled={
                          saving
                        }
                        className="flex h-9 w-9 items-center justify-center rounded-xl text-lg font-black text-slate-300 transition hover:bg-blue-500/10 hover:text-blue-300 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-2">
              {owned && (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTradingCard(card);
                    setTradeQuantity(1);
                    setTradeError("");
                    setTradeMessage("");
                  }}
                  className="w-full rounded-xl border border-blue-400/20 bg-blue-500/[0.06] px-3 py-2.5 text-[10px] font-black text-blue-300 transition hover:border-blue-400/50 hover:bg-blue-500/[0.14]"
                >
                  🔄 Trocar carta
                </button>
              )}
            </div>

            {/* AÇÕES DE PREÇO */}

            <div
              onClick={(event) =>
                event.stopPropagation()
              }
              className="mt-3 grid grid-cols-1 gap-2"
            >
              {!hasAnyPrice &&
                !card.isManualPrice && (
                  <button
                    type="button"
                    onClick={() =>
                      openPriceEditor(
                        card
                      )
                    }
                    className="w-full rounded-xl border border-blue-400/15 bg-blue-500/[0.05] px-3 py-2.5 text-[10px] font-black text-blue-300 transition hover:border-blue-400/35 hover:bg-blue-500/10"
                  >
                    ✎ Adicionar preço
                  </button>
                )}

              {card.isManualPrice && (
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      openPriceEditor(
                        card
                      )
                    }
                    className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[10px] font-black text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    ✎ Editar
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void removeManualPrice(
                        card
                      )
                    }
                    disabled={
                      priceSaving
                    }
                    className="rounded-xl border border-red-500/10 bg-red-500/[0.04] px-3 py-2.5 text-[10px] font-black text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
                  >
                    Remover
                  </button>
                </div>
              )}
            </div>

            {
              renderPriceEditor(
                card
              )
            }
          </div>
        </div>
      </article>
    );
  }

  /* =======================================================
     OPEN REGISTERED POKÉMON
  ======================================================= */

  async function openRegisteredPokemon(
    item: RegisteredPokemon
  ) {
    try {
      setSelected(
        item
      );

      setRegisteredCards(
        []
      );

      setRegisteredCardsError(
        ""
      );

      setRegisteredCardsLoading(
        true
      );

      setSelectedOwnedCount(
        0
      );

      setSelectedOwnedQuantity(
        0
      );

      setSelectedTotalCount(
        0
      );

      setPriceError(
        ""
      );

      setPriceSuccess(
        ""
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      const response =
        await fetch(
          `/api/pokedex?search=${encodeURIComponent(
            item.name
          )}`,
          {
            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível carregar as cartas."
        );
      }

      const cards =
        Array.isArray(
          data.cards
        )
          ? data.cards
          : [];

      setRegisteredCards(
        cards
      );

      setSelectedTotalCount(
        cards.length
      );

      setSelectedOwnedCount(
        typeof data.ownedCount ===
          "number"
          ? data.ownedCount
          : cards.filter(
              isCardOwned
            ).length
      );

      setSelectedOwnedQuantity(
        typeof data.ownedQuantity ===
          "number"
          ? data.ownedQuantity
          : cards.reduce(
              (
                total,
                card
              ) =>
                total +
                getOwnedQuantity(
                  card
                ),
              0
            )
      );

      setTimeout(
        () => {
          document
            .getElementById(
              "selected-pokemon"
            )
            ?.scrollIntoView({
              behavior:
                "smooth",
              block:
                "start",
            });
        },
        50
      );
    } catch (
      err
    ) {
      setRegisteredCardsError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar as cartas."
      );
    } finally {
      setRegisteredCardsLoading(
        false
      );
    }
  }

  /* =======================================================
     SEARCH
  ======================================================= */

  async function searchCardsByName(
    event?: FormEvent
  ) {
    event?.preventDefault();

    const term =
      search.trim();

    if (
      term.length < 2
    ) {
      setSearchError(
        "Digite pelo menos 2 caracteres para buscar."
      );

      setSearchExecuted(
        false
      );

      setSearchCards(
        []
      );

      return;
    }

    try {
      setSearchLoading(
        true
      );

      setSearchError(
        ""
      );

      setPriceError(
        ""
      );

      setPriceSuccess(
        ""
      );

      setOwnedError(
        ""
      );

      setCollectionMessage(
        ""
      );

      setSearchExecuted(
        true
      );

      setSearchedName(
        term
      );

      setSearchCards(
        []
      );

      setActiveCategory(
        "all"
      );

      const response =
        await fetch(
          `/api/pokedex?search=${encodeURIComponent(
            term
          )}`,
          {
            cache:
              "no-store",

            headers: {
              Accept:
                "application/json",
            },
          }
        );

      const data =
        await parseJson(
          response
        );

      if (
        !response.ok ||
        !data.success
      ) {
        throw new Error(
          data.error ||
            data.message ||
            "Não foi possível pesquisar as cartas."
        );
      }

      const cards =
        Array.isArray(
          data.cards
        )
          ? data.cards
          : [];

      setSearchCards(
        cards
      );

      setSearchedName(
        data.searchName ||
          data.search ||
          term
      );

      setTimeout(
        () => {
          document
            .getElementById(
              "search-results"
            )
            ?.scrollIntoView({
              behavior:
                "smooth",
              block:
                "start",
            });
        },
        50
      );
    } catch (
      err
    ) {
      setSearchError(
        err instanceof Error
          ? err.message
          : "Erro ao pesquisar as cartas."
      );
    } finally {
      setSearchLoading(
        false
      );
    }
  }

  /* =======================================================
     EFFECT
  ======================================================= */

  useEffect(() => {
    void loadRegistered();
    void loadCollectionSummary();
  }, []);

  /* =======================================================
     DERIVADOS
  ======================================================= */

  const filteredRegistered =
    useMemo(
      () =>
        registered,
      [
        registered,
      ]
    );

  const categoryCounts =
    useMemo(() => {
      const counts: Record<
        CollectionCategory,
        number
      > = {
        pokemon:
          0,
        trainer:
          0,
        energy:
          0,
        stadium:
          0,
      };

      for (
        const card of
          searchCards
      ) {
        counts[
          getCardCategory(
            card
          )
        ] += 1;
      }

      return counts;
    }, [
      searchCards,
    ]);

  const filteredSearchCards =
    useMemo(() => {
      if (
        activeCategory ===
        "all"
      ) {
        return searchCards;
      }

      return searchCards.filter(
        (
          card
        ) =>
          getCardCategory(
            card
          ) ===
          activeCategory
      );
    }, [
      searchCards,
      activeCategory,
    ]);

  const selectedPercentage =
    collectionPercentage(
      selectedOwnedCount,
      selectedTotalCount
    );

  /* =======================================================
     CARTA DETALHE
  ======================================================= */

  function renderCardDetails() {
    if (!selectedCard) {
      return null;
    }

    const image =
      cardImage(
        selectedCard
      );

    const usd =
      cardUsd(
        selectedCard
      );

    const brl =
      cardBrl(
        selectedCard
      );

    const eur =
      cardEur(
        selectedCard
      );

    const owned =
      isCardOwned(
        selectedCard
      );

    const quantity =
      getOwnedQuantity(
        selectedCard
      );

    const category =
      getCardCategory(
        selectedCard
      );

    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-black/85 p-3 backdrop-blur-xl sm:p-6"
        onClick={() =>
          setSelectedCard(
            null
          )
        }
      >
        <div
          className="relative my-4 w-full max-w-6xl overflow-hidden rounded-[2rem] border border-blue-500/20 bg-[#03050a] shadow-[0_40px_120px_rgba(0,0,0,0.75)]"
          onClick={(event) =>
            event.stopPropagation()
          }
        >
          {/* TOP BAR */}

          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
            <button
              type="button"
              onClick={() =>
                setSelectedCard(
                  null
                )
              }
              className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-black text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
            >
              ← Voltar
            </button>

            <div className="flex items-center gap-2">
              {owned && (
                <span className="rounded-full bg-blue-500/15 px-3 py-1.5 text-[9px] font-black text-blue-300">
                  ✓ Na coleção
                </span>
              )}

              <button
                type="button"
                onClick={() =>
                  setSelectedCard(
                    null
                  )
                }
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-lg text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
                aria-label="Fechar"
              >
                ×
              </button>
            </div>
          </div>

          {/* CONTENT */}

          <div className="grid min-w-0 lg:grid-cols-[0.8fr_1.2fr]">
            {/* CARD SIDE */}

            <div className="relative flex min-h-[520px] items-center justify-center overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.16),transparent_58%)] p-8 lg:min-h-[720px] lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:45px_45px]" />

              {image ? (
                <img
                  src={
                    image
                  }
                  alt={`${selectedCard.name} ${
                    selectedCard
                      .set
                      ?.name ||
                    ""
                  }`}
                  className="relative z-10 max-h-[600px] max-w-[85%] rounded-2xl object-contain drop-shadow-[0_35px_80px_rgba(0,0,0,0.7)]"
                />
              ) : (
                <div className="relative z-10 text-center text-slate-600">
                  <div className="text-7xl">
                    🖼️
                  </div>

                  <p className="mt-3 text-sm">
                    Imagem indisponível
                  </p>
                </div>
              )}

              <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-2">
                <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[9px] font-black text-slate-300 backdrop-blur">
                  {
                    categoryLabel(
                      category
                    )
                  }
                </span>

                <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1.5 text-[9px] font-black text-slate-300 backdrop-blur">
                  #
                  {
                    selectedCard.number ||
                    "—"
                  }
                </span>
              </div>
            </div>

            {/* INFO SIDE */}

            <div className="min-w-0 p-5 sm:p-7 lg:p-9">
              <p className="text-[9px] font-black uppercase tracking-[0.3em] text-blue-400">
                Detalhes da impressão
              </p>

              <h2 className="mt-3 break-words text-3xl font-black tracking-tight text-white sm:text-4xl">
                {
                  selectedCard.name
                }
              </h2>

              <p className="mt-2 break-words text-sm text-slate-500">
                {
                  selectedCard
                    .set
                    ?.name ||
                  "Coleção não informada"
                }
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold text-slate-300">
                  {
                    selectedCard.rarity ||
                    "Raridade não informada"
                  }
                </span>

                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold text-slate-300">
                  #
                  {
                    selectedCard.number ||
                    "—"
                  }
                </span>

                {selectedCard.isManualPrice && (
                  <span className="rounded-full bg-blue-500/15 px-3 py-1.5 text-[10px] font-black text-blue-300">
                    Preço manual
                  </span>
                )}
              </div>

              {/* COLLECTION */}

              <div className="mt-7 rounded-2xl border border-blue-400/15 bg-blue-500/[0.045] p-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                      Minha coleção
                    </p>

                    <p className="mt-1 text-lg font-black text-white">
                      {owned
                        ? quantity ===
                          1
                          ? "Tenho 1 unidade"
                          : `Tenho ${quantity} unidades`
                        : "Ainda não tenho"}
                    </p>
                  </div>

                  {!owned ? (
                    <button
                      type="button"
                      onClick={() =>
                        void toggleOwnedCard(
                          selectedCard
                        )
                      }
                      disabled={
                        ownedSavingCardId ===
                        selectedCard.id
                      }
                      className="rounded-xl bg-blue-500 px-5 py-3 text-xs font-black text-white transition hover:bg-blue-400 disabled:opacity-60"
                    >
                      {ownedSavingCardId ===
                      selectedCard.id
                        ? "Salvando..."
                        : "+ Adicionar à coleção"}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1 rounded-2xl border border-blue-400/20 bg-black/30 p-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void removeOwnedUnit(
                            selectedCard
                          )
                        }
                        disabled={
                          ownedSavingCardId ===
                          selectedCard.id
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-slate-300 hover:bg-red-500/10 hover:text-red-300"
                      >
                        −
                      </button>

                      <div className="flex h-10 min-w-14 items-center justify-center rounded-xl bg-white/[0.04] px-3">
                        <span className="font-black text-blue-300">
                          {
                            quantity
                          }
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          void addOwnedUnit(
                            selectedCard
                          )
                        }
                        disabled={
                          ownedSavingCardId ===
                          selectedCard.id
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-xl text-lg font-black text-slate-300 hover:bg-blue-500/10 hover:text-blue-300"
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* MARKET VALUE */}

              <div className="mt-5">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-slate-600">
                      Market value
                    </p>

                    <p className="mt-2 text-3xl font-black text-blue-300 sm:text-4xl">
                      {
                        money(
                          brl,
                          "BRL"
                        )
                      }
                    </p>
                  </div>

                  <span className="rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-1.5 text-[9px] font-black text-slate-500">
                    {selectedCard.isManualPrice
                      ? "Manual"
                      : "Atual"}
                  </span>
                </div>
              </div>

              {/* HISTÓRICO DE VALOR */}

              {(() => {
                const history = (selectedCard.priceHistory || [])
                  .filter(
                    (point) =>
                      typeof point.brl === "number" &&
                      Number.isFinite(point.brl) &&
                      point.brl > 0
                  )
                  .sort((a, b) => {
                    const aTime = a.capturedAt
                      ? new Date(a.capturedAt).getTime()
                      : 0;
                    const bTime = b.capturedAt
                      ? new Date(b.capturedAt).getTime()
                      : 0;
                    return aTime - bTime;
                  });

                const historyValues = history
                  .map((point) => point.brl as number)
                  .filter(Number.isFinite);

                const currentValue = hasValidPrice(brl)
                  ? (brl as number)
                  : historyValues[historyValues.length - 1] ?? null;

                /*
                 * Caso ainda não exista histórico gravado para a carta,
                 * usamos o valor atual como o primeiro ponto do gráfico.
                 */
                const chartHistory =
                  history.length > 0
                    ? history
                    : currentValue !== null
                      ? [
                          {
                            brl: currentValue,
                            usd: hasValidPrice(usd) ? (usd as number) : null,
                            source:
                              selectedCard.priceSource ||
                              selectedCard.manualPrice?.source ||
                              "Valor atual",
                            capturedAt:
                              selectedCard.manualPrice?.updatedAt ||
                              new Date().toISOString(),
                          },
                        ]
                      : [];

                const values = chartHistory
                  .map((point) => point.brl as number)
                  .filter(Number.isFinite);

                const minValue = values.length
                  ? Math.min(...values)
                  : null;

                const maxValue = values.length
                  ? Math.max(...values)
                  : null;

                const firstValue = values[0] ?? null;

                const variation =
                  firstValue !== null &&
                  currentValue !== null &&
                  firstValue > 0
                    ? ((currentValue - firstValue) / firstValue) * 100
                    : null;

                const chartWidth = 1000;
                const chartHeight = 300;
                const padX = 28;
                const padY = 28;
                const innerWidth = chartWidth - padX * 2;
                const innerHeight = chartHeight - padY * 2;

                /*
                 * Linha do tempo fixa desde 01/01/2026 até hoje.
                 * Isso posiciona o registro real na data em que foi capturado,
                 * sem inventar valores para dias anteriores.
                 */
                const chartStart = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();
                const today = new Date();
                const chartEnd = Math.max(
                  chartStart + 24 * 60 * 60 * 1000,
                  today.getTime()
                );

                const chartMin =
                  minValue !== null && maxValue !== null
                    ? minValue === maxValue
                      ? Math.max(0, minValue * 0.9)
                      : Math.max(0, minValue - (maxValue - minValue) * 0.12)
                    : 0;

                const chartMax =
                  minValue !== null && maxValue !== null
                    ? minValue === maxValue
                      ? maxValue * 1.1 || 1
                      : maxValue + (maxValue - minValue) * 0.12
                    : 1;

                const points = chartHistory.map((point, index) => {
                  const value = point.brl as number;
                  const captured = point.capturedAt
                    ? new Date(point.capturedAt).getTime()
                    : chartEnd;

                  const safeTime = Number.isFinite(captured)
                    ? Math.min(chartEnd, Math.max(chartStart, captured))
                    : chartEnd;

                  const x =
                    padX +
                    ((safeTime - chartStart) /
                      (chartEnd - chartStart)) *
                      innerWidth;

                  const normalized =
                    chartMax === chartMin
                      ? 0.5
                      : (value - chartMin) / (chartMax - chartMin);

                  const y =
                    padY + (1 - normalized) * innerHeight;

                  return { ...point, x, y, value, safeTime };
                });

                const linePath =
                  points.length > 1
                    ? points
                        .map(
                          (point, index) =>
                            `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`
                        )
                        .join(" ")
                    : "";

                const areaPath =
                  linePath && points.length > 1
                    ? `${linePath} L ${points[points.length - 1].x.toFixed(2)} ${chartHeight - padY} L ${points[0].x.toFixed(2)} ${chartHeight - padY} Z`
                    : "";

                const formatDate = (value?: string | null) => {
                  if (!value) return "—";

                  const date = new Date(value);
                  if (Number.isNaN(date.getTime())) return "—";

                  return new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  }).format(date);
                };

                const formatRangeDate = (timestamp: number) =>
                  new Intl.DateTimeFormat("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  }).format(new Date(timestamp));

                const currentChartPoint =
                  points[points.length - 1] || null;

                return (
                  <div className="mt-5 rounded-[1.5rem] border border-blue-500/15 bg-[#04060a] p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-blue-500/15 bg-blue-500/10 text-sm text-blue-300">
                            ↗
                          </span>

                          <div>
                            <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                              Histórico de valor
                            </p>

                            <p className="mt-1 text-xs font-bold text-slate-400">
                              Evolução registrada da impressão
                            </p>
                          </div>
                        </div>
                      </div>

                      {variation !== null && (
                        <span
                          className={`w-fit rounded-full border px-2.5 py-1.5 text-[9px] font-black ${
                            variation >= 0
                              ? "border-blue-400/20 bg-blue-500/10 text-blue-300"
                              : "border-red-400/20 bg-red-500/10 text-red-300"
                          }`}
                        >
                          {variation >= 0 ? "↗" : "↘"} {Math.abs(variation).toFixed(1)}%
                        </span>
                      )}
                    </div>

                    {values.length === 0 ? (
                      <div className="mt-5 flex min-h-52 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/20 px-5 text-center">
                        <div>
                          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-500/15 bg-blue-500/10 text-blue-300">
                            ∿
                          </div>

                          <p className="mt-3 text-xs font-black text-slate-500">
                            Aguardando histórico de preços
                          </p>

                          <p className="mt-1 text-[10px] leading-5 text-slate-700">
                            Novas alterações de valor serão adicionadas ao gráfico.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="mt-5 grid grid-cols-3 gap-2">
                          <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-700">
                              Máximo
                            </p>
                            <p className="mt-1 text-sm font-black text-slate-300">
                              {money(maxValue, "BRL")}
                            </p>
                          </div>

                          <div className="rounded-xl border border-blue-400/10 bg-blue-500/[0.06] p-3">
                            <p className="text-[8px] font-black uppercase tracking-widest text-blue-300/60">
                              Atual
                            </p>
                            <p className="mt-1 text-sm font-black text-blue-300">
                              {money(currentValue, "BRL")}
                            </p>
                          </div>

                          <div className="rounded-xl border border-white/5 bg-white/[0.025] p-3">
                            <p className="text-[8px] font-black uppercase tracking-widest text-slate-700">
                              Mínimo
                            </p>
                            <p className="mt-1 text-sm font-black text-slate-300">
                              {money(minValue, "BRL")}
                            </p>
                          </div>
                        </div>

                        <div className="mt-4 overflow-hidden rounded-2xl border border-white/5 bg-black/30 p-2 sm:p-3">
                          <div className="relative h-56 w-full overflow-hidden rounded-xl bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:100%_25%] sm:h-64">
                            <svg
                              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                              preserveAspectRatio="none"
                              className="absolute inset-0 h-full w-full"
                              role="img"
                              aria-label="Gráfico histórico de valor em BRL"
                            >
                              <defs>
                                <linearGradient id="priceAreaGradient" x1="0" x2="0" y1="0" y2="1">
                                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                                </linearGradient>
                              </defs>

                              {[0, 1, 2, 3, 4].map((step) => {
                                const y =
                                  padY +
                                  (step / 4) * innerHeight;

                                return (
                                  <line
                                    key={step}
                                    x1={padX}
                                    x2={chartWidth - padX}
                                    y1={y}
                                    y2={y}
                                    stroke="rgba(255,255,255,0.06)"
                                    strokeWidth="1"
                                  />
                                );
                              })}

                              {areaPath && (
                                <path
                                  d={areaPath}
                                  fill="url(#priceAreaGradient)"
                                />
                              )}

                              {points.length === 1 && (
                                <>
                                  <line
                                    x1={padX}
                                    x2={points[0].x}
                                    y1={points[0].y}
                                    y2={points[0].y}
                                    stroke="#3b82f6"
                                    strokeOpacity="0.22"
                                    strokeWidth="4"
                                    strokeDasharray="10 10"
                                    vectorEffect="non-scaling-stroke"
                                  />

                                  <line
                                    x1={points[0].x}
                                    x2={points[0].x}
                                    y1={padY}
                                    y2={chartHeight - padY}
                                    stroke="#60a5fa"
                                    strokeOpacity="0.14"
                                    strokeWidth="2"
                                    strokeDasharray="5 8"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </>
                              )}

                              {linePath && (
                                <path
                                  d={linePath}
                                  fill="none"
                                  stroke="#3b82f6"
                                  strokeWidth="5"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  vectorEffect="non-scaling-stroke"
                                />
                              )}

                              {points.map((point, index) => (
                                <g key={`${point.capturedAt || index}-${point.value}`}>
                                  <circle
                                    cx={point.x}
                                    cy={point.y}
                                    r="9"
                                    fill="#03050a"
                                    stroke="#60a5fa"
                                    strokeWidth="4"
                                  />

                                  <circle
                                    cx={point.x}
                                    cy={point.y}
                                    r="3"
                                    fill="#dbeafe"
                                  />
                                </g>
                              ))}
                            </svg>

                            <div className="pointer-events-none absolute inset-x-3 bottom-2 flex items-center justify-between text-[8px] font-bold text-slate-700">
                              <span>{formatRangeDate(chartStart)}</span>

                              <span className="rounded-full border border-white/5 bg-black/30 px-2 py-1 text-slate-600">
                                {points.length} registro{points.length === 1 ? "" : "s"}
                              </span>

                              <span>{formatRangeDate(chartEnd)}</span>
                            </div>

                            {points.length === 1 && (
                              <div
                                className="pointer-events-none absolute top-3 hidden -translate-x-1/2 rounded-lg border border-blue-500/20 bg-[#05070c]/90 px-2.5 py-1.5 text-[8px] font-black text-blue-300 shadow-lg sm:block"
                                style={{
                                  left: `${Math.min(96, Math.max(4, ((currentChartPoint!.safeTime - chartStart) / (chartEnd - chartStart)) * 100))}%`,
                                }}
                              >
                                {formatDate(currentChartPoint!.capturedAt)} · {money(currentChartPoint!.value, "BRL")}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3 text-[9px] font-bold text-slate-700">
                          <span>
                            {values.length} registro{values.length === 1 ? "" : "s"}
                          </span>

                          <span>
                            {history[history.length - 1]?.source ||
                              selectedCard.priceSource ||
                              "Fonte não informada"}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* CURRENCIES */}

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-blue-400/10 bg-blue-500/[0.05] p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-blue-300/60">
                    USD
                  </p>

                  <p className="mt-1 text-sm font-black text-blue-200">
                    {
                      money(
                        usd,
                        "USD"
                      )
                    }
                  </p>
                </div>

                <div className="rounded-xl bg-white/[0.03] p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                    BRL
                  </p>

                  <p className="mt-1 text-sm font-black text-white">
                    {
                      money(
                        brl,
                        "BRL"
                      )
                    }
                  </p>
                </div>

                <div className="rounded-xl bg-white/[0.03] p-3">
                  <p className="text-[8px] font-black uppercase tracking-widest text-slate-600">
                    EUR
                  </p>

                  <p className="mt-1 text-sm font-black text-white">
                    {
                      money(
                        eur,
                        "EUR"
                      )
                    }
                  </p>
                </div>
              </div>

              {/* ACTIONS */}

              <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">

                {isCardOwned(selectedCard) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTradingCard(selectedCard);
                      setTradeQuantity(1);
                      setTradeError("");
                      setTradeMessage("");
                    }}
                    className="rounded-xl border border-blue-400/20 bg-blue-500/[0.06] px-4 py-3 text-xs font-black text-blue-300 transition hover:border-blue-400/50 hover:bg-blue-500/[0.14]"
                  >
                    🔄 Trocar carta
                  </button>
                )}

                {selectedCard.isManualPrice ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        openPriceEditor(
                          selectedCard
                        )
                      }
                      className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                    >
                      ✎ Editar preço
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void removeManualPrice(
                          selectedCard
                        )
                      }
                      className="rounded-xl border border-red-500/10 bg-red-500/[0.04] px-4 py-3 text-xs font-black text-red-300 transition hover:bg-red-500/10"
                    >
                      Remover preço
                    </button>
                  </>
                ) : !hasValidPrice(
                    brl
                  ) ? (
                  <button
                    type="button"
                    onClick={() =>
                      openPriceEditor(
                        selectedCard
                      )
                    }
                    className="sm:col-span-2 rounded-xl bg-blue-500 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-400"
                  >
                    + Adicionar preço manual
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      openPriceEditor(
                        selectedCard
                      )
                    }
                    className="sm:col-span-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black text-slate-300 transition hover:bg-white/[0.06] hover:text-white"
                  >
                    ✎ Editar preço
                  </button>
                )}
              </div>

              {
                renderPriceEditor(
                  selectedCard
                )
              }

              {/* EXTRA DATA */}

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-700">
                      Série
                    </p>

                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {
                        selectedCard
                          .set
                          ?.series ||
                        "Não informada"
                      }
                    </p>
                  </div>

                  <div>
                    <p className="text-[8px] font-black uppercase tracking-widest text-slate-700">
                      Fonte
                    </p>

                    <p className="mt-1 text-xs font-bold text-slate-400">
                      {
                        selectedCard
                          .priceSource ||
                        "Não informada"
                      }
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     RENDER
  ======================================================= */

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#010204] text-white">
      <style jsx global>{POKEMON_MOTION_STYLE}</style>
      {/* BACKGROUND */}

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-20 h-96 w-96 rounded-full bg-blue-600/[0.055] blur-[120px]" />

        <div className="absolute right-0 top-[35%] h-96 w-96 rounded-full bg-blue-500/[0.04] blur-[120px]" />

        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-cyan-500/[0.025] blur-[120px]" />
      </div>

      <div className="relative mx-auto min-h-screen w-full max-w-7xl px-3 py-5 sm:px-6 sm:py-7 lg:px-8">
        {/* =================================================
            HEADER
        ================================================= */}

        <header className="flex min-w-0 items-center justify-between gap-3 border-b border-white/10 pb-5">
          <button
            type="button"
            onClick={() =>
              router.push(
                "/"
              )
            }
            className="group flex min-w-0 items-center gap-3 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-blue-500/20 bg-blue-500/10 text-lg text-blue-300 shadow-lg shadow-blue-500/5">
              ⚡
            </span>

            <span className="min-w-0">
              <span className="block truncate text-lg font-black tracking-tight sm:text-xl">
                POKÉSCAN
              </span>

              <span className="block truncate text-xs text-slate-500">
                Collection
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() =>
              router.push(
                "/"
              )
            }
            className="shrink-0 rounded-xl border border-blue-500/25 bg-blue-500/[0.08] px-3 py-2 text-[10px] font-black text-blue-300 transition hover:border-blue-400/50 hover:bg-blue-500/[0.14] sm:px-4 sm:py-2.5 sm:text-xs"
          >
            ← Scanner
          </button>
        </header>

        {/* =================================================
            HERO
        ================================================= */}

        <section className="py-6 sm:py-8 lg:py-10">
          <div className="rounded-[2rem] border border-white/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.06),rgba(255,255,255,0.015))] p-5 shadow-2xl shadow-black/40 sm:p-7 lg:p-8">
            <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-blue-300">
                  <span>
                    ◆
                  </span>

                  Collection
                </div>

                <h1 className="mt-4 break-words text-3xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                  Minha{" "}
                  <span className="text-blue-300">
                    Pokédex
                  </span>
                </h1>

                <p className="mt-3 max-w-2xl break-words text-sm leading-6 text-slate-500 sm:text-base">
                  Organize sua coleção de Pokémon e cartas em uma interface mais próxima de um app profissional de TCG.
                </p>
              </div>

              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 sm:min-w-[125px] sm:px-5 sm:py-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">
                    Pokémon
                  </p>

                  <p className="mt-1 text-2xl font-black text-white">
                    {
                      registered.length
                    }
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.07] px-4 py-3 sm:min-w-[125px] sm:px-5 sm:py-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-blue-300/60">
                    Cartas
                  </p>

                  <p className="mt-1 text-2xl font-black text-blue-300">
                    {
                      collectionSummary
                        .all
                        .models
                    }
                  </p>

                  <p className="mt-1 text-[9px] font-bold text-blue-300/40">
                    {
                      collectionSummary
                        .all
                        .quantity
                    }{" "}
                    unidades
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* =================================================
              BUSCA
          ================================================= */}

          <section className="mt-5 overflow-hidden rounded-[1.75rem] border border-blue-500/15 bg-[#05070c] shadow-2xl shadow-black/30 sm:rounded-[2rem]">
            <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/[0.08] via-transparent to-transparent px-4 py-5 sm:px-7">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-blue-500/15 bg-blue-500/10 text-lg text-blue-300">
                  🔎
                </div>

                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                    Pesquisa
                  </p>

                  <h2 className="mt-1 truncate text-lg font-black sm:text-xl">
                    Buscar cartas
                  </h2>

                  <p className="break-words text-xs text-slate-600">
                    Pokémon, treinadores, energias ou estádios.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-7">
              <form
                onSubmit={
                  searchCardsByName
                }
                className="flex w-full min-w-0 flex-col gap-3 sm:flex-row"
              >
                <div className="relative min-w-0 flex-1">
                  <input
                    value={
                      search
                    }
                    onChange={(
                      event
                    ) =>
                      setSearch(
                        event.target
                          .value
                      )
                    }
                    placeholder="Ex.: Skrelp, Charizard, Energia de Fogo..."
                    className="w-full min-w-0 rounded-2xl border border-white/10 bg-black/60 px-4 py-4 pr-10 text-sm text-white outline-none transition placeholder:text-slate-700 focus:border-blue-500/45 focus:ring-2 focus:ring-blue-500/10"
                  />

                  {search && (
                    <button
                      type="button"
                      onClick={() =>
                        setSearch(
                          ""
                        )
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-700 transition hover:bg-white/5 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={
                    searchLoading
                  }
                  className="w-full shrink-0 rounded-2xl bg-blue-500 px-7 py-4 text-sm font-black text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {searchLoading
                    ? "Buscando..."
                    : "Buscar cartas"}
                </button>
              </form>

              {searchError && (
                <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <span className="shrink-0">
                    !
                  </span>

                  <span className="break-words">
                    {
                      searchError
                    }
                  </span>
                </div>
              )}

              {priceSuccess && (
                <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-300">
                  <span className="shrink-0">
                    ✓
                  </span>

                  <span className="break-words">
                    {
                      priceSuccess
                    }
                  </span>
                </div>
              )}

              {collectionMessage && (
                <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                  <span className="shrink-0">
                    ✓
                  </span>

                  <span className="break-words">
                    {
                      collectionMessage
                    }
                  </span>
                </div>
              )}

              {tradeMessage && (
                <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-blue-400/20 bg-blue-500/10 px-4 py-3 text-sm text-blue-200">
                  <span className="shrink-0">✓</span>
                  <span className="break-words">{tradeMessage}</span>
                </div>
              )}

              {ownedError && (
                <div className="mt-4 flex min-w-0 items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  <span className="shrink-0">
                    !
                  </span>

                  <span className="break-words">
                    {
                      ownedError
                    }
                  </span>
                </div>
              )}

              {/* RESULTADO */}

              {searchExecuted &&
                !searchLoading &&
                !searchError && (
                  <div
                    id="search-results"
                    className="mt-7"
                  >
                    <div className="flex min-w-0 flex-col gap-4 border-b border-white/10 pb-5">
                      <div className="min-w-0">
                        <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                          Resultado da busca
                        </p>

                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                          <h3 className="max-w-full break-words text-2xl font-black sm:text-3xl">
                            {
                              searchedName
                            }
                          </h3>

                          <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] font-black text-slate-400">
                            {
                              searchCards.length
                            }{" "}
                            modelos
                          </span>
                        </div>
                      </div>

                      {searchCards.length >
                        0 && (
                        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveCategory(
                                "all"
                              )
                            }
                            className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black transition ${
                              activeCategory ===
                              "all"
                                ? "border-blue-400/40 bg-blue-500/10 text-blue-300"
                                : "border-white/10 bg-white/[0.03] text-slate-500 hover:bg-white/[0.06]"
                            }`}
                          >
                            Todas{" "}
                            {
                              searchCards.length
                            }
                          </button>

                          {(
                            [
                              "pokemon",
                              "trainer",
                              "energy",
                              "stadium",
                            ] as CollectionCategory[]
                          ).map(
                            (
                              category
                            ) =>
                              categoryCounts[
                                category
                              ] >
                                0 && (
                                <button
                                  key={
                                    category
                                  }
                                  type="button"
                                  onClick={() =>
                                    setActiveCategory(
                                      category
                                    )
                                  }
                                  className={`shrink-0 rounded-xl border px-3 py-2 text-[10px] font-black transition ${
                                    activeCategory ===
                                    category
                                      ? "border-blue-400/40 bg-blue-500/10 text-blue-300"
                                      : "border-white/10 bg-white/[0.03] text-slate-500 hover:bg-white/[0.06]"
                                  }`}
                                >
                                  {
                                    categoryLabel(
                                      category
                                    )
                                  }{" "}
                                  {
                                    categoryCounts[
                                      category
                                    ]
                                  }
                                </button>
                              )
                          )}
                        </div>
                      )}
                    </div>

                    {searchCards.length ===
                    0 ? (
                      <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.015] p-10 text-center">
                        <div className="text-5xl">
                          🔍
                        </div>

                        <h4 className="mt-4 text-lg font-black">
                          Nenhuma carta encontrada
                        </h4>

                        <p className="mx-auto mt-2 max-w-md break-words text-sm leading-6 text-slate-600">
                          Tente outro nome ou use o nome oficial da carta.
                        </p>
                      </div>
                    ) : filteredSearchCards.length ===
                      0 ? (
                      <div className="mt-6 rounded-3xl border border-dashed border-white/10 bg-white/[0.015] p-10 text-center">
                        <div className="text-4xl">
                          📂
                        </div>

                        <p className="mt-3 text-sm font-bold text-slate-500">
                          Nenhuma carta nesta categoria.
                        </p>
                      </div>
                    ) : (
                      <div className="mt-6 grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {filteredSearchCards.map(
                          (
                            card
                          ) =>
                            renderCard(
                              card
                            )
                        )}
                      </div>
                    )}
                  </div>
                )}
            </div>
          </section>

          {/* =================================================
              PASTAS
          ================================================= */}

          <div className="mt-6">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                  Biblioteca
                </p>

                <h2 className="mt-1 text-xl font-black text-white sm:text-2xl">
                  Pastas da coleção
                </h2>
              </div>

              <span className="rounded-full border border-white/10 bg-white/[0.025] px-3 py-1.5 text-[9px] font-black text-slate-600">
                {
                  collectionSummary
                    .all
                    .models
                }{" "}
                cartas
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
              {(
                [
                  "pokemon",
                  "trainer",
                  "energy",
                  "stadium",
                ] as CollectionCategory[]
              ).map(
                (
                  category
                ) => {
                  const summary =
                    collectionSummary[
                      category
                    ];

                  const isOpen =
                    openCollection ===
                    category;

                  return (
                    <button
                      key={
                        category
                      }
                      type="button"
                      onClick={() =>
                        void openCollectionFolder(
                          category
                        )
                      }
                      className={`group relative min-w-0 overflow-hidden rounded-[1.35rem] border p-4 text-left transition duration-300 sm:p-5 ${
                        isOpen
                          ? "border-blue-400/45 bg-blue-500/[0.055] shadow-lg shadow-blue-500/5"
                          : "border-white/10 bg-[#05070c] hover:-translate-y-0.5 hover:border-blue-400/30 hover:bg-[#080b12]"
                      }`}
                    >
                      {isOpen && (
                        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-500" />
                      )}

                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg ${
                            isOpen
                              ? "bg-blue-500 text-white"
                              : "bg-blue-500/10 text-blue-300"
                          }`}
                        >
                          {
                            categoryIcon(
                              category
                            )
                          }
                        </div>

                        <span
                          className={`text-lg ${
                            isOpen
                              ? "text-blue-300"
                              : "text-slate-700 group-hover:translate-x-1 group-hover:text-blue-300"
                          }`}
                        >
                          {isOpen
                            ? "↓"
                            : "→"}
                        </span>
                      </div>

                      <p className="mt-4 truncate text-sm font-black text-white">
                        {
                          categoryLabel(
                            category
                          )
                        }
                      </p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <span className="rounded-full bg-white/[0.04] px-2 py-1 text-[9px] font-bold text-slate-600">
                          {
                            summary.models
                          }{" "}
                          modelo
                          {
                            summary.models ===
                            1
                              ? ""
                              : "s"
                          }
                        </span>

                        <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[9px] font-bold text-blue-300/70">
                          {
                            summary.quantity
                          }{" "}
                          un.
                        </span>
                      </div>

                      <p className="mt-2 text-[10px] leading-4 text-slate-700">
                        {isOpen
                          ? "Pasta aberta"
                          : "Ver cartas"}
                      </p>
                    </button>
                  );
                }
              )}
            </div>
          </div>

          {/* =================================================
              PASTA ABERTA
          ================================================= */}

          {openCollection && (
            <section
              id={`collection-${openCollection}`}
              className="mt-5 overflow-hidden rounded-[2rem] border border-blue-500/20 bg-[#05070b] shadow-2xl shadow-black/35"
            >
              <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/[0.08] via-transparent to-transparent p-5 sm:p-7">
                <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-300">
                        {
                          categoryIcon(
                            openCollection
                          )
                        }
                      </span>

                      <p className="text-[9px] font-black uppercase tracking-[0.28em] text-blue-400">
                        Pasta da coleção
                      </p>
                    </div>

                    <h2 className="mt-3 break-words text-2xl font-black sm:text-3xl">
                      {
                        categoryLabel(
                          openCollection
                        )
                      }
                    </h2>

                    <div className="mt-2 flex flex-wrap gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] font-bold text-slate-500">
                        {
                          collectionSummary[
                            openCollection
                          ].models
                        }{" "}
                        modelos
                      </span>

                      <span className="rounded-full border border-blue-400/15 bg-blue-500/[0.05] px-2.5 py-1 text-[9px] font-bold text-blue-300/80">
                        {
                          collectionSummary[
                            openCollection
                          ].quantity
                        }{" "}
                        unidades
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setOpenCollection(
                        null
                      );
                      setCollectionCards(
                        []
                      );
                    }}
                    className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-[10px] font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white sm:w-auto"
                  >
                    Fechar pasta
                  </button>
                </div>
              </div>

              <div className="p-4 sm:p-6 lg:p-7">
                {collectionLoading ? (
                  <div className="py-14 text-center">
                    <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />

                    <p className="mt-4 text-sm text-slate-500">
                      Carregando cartas...
                    </p>
                  </div>
                ) : collectionError ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center">
                    <div className="text-4xl">
                      ⚠️
                    </div>

                    <p className="mt-3 break-words text-sm text-red-300">
                      {
                        collectionError
                      }
                    </p>

                    <button
                      type="button"
                      onClick={() =>
                        void openCollectionFolder(
                          openCollection
                        )
                      }
                      className="mt-5 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-black text-white transition hover:bg-blue-400"
                    >
                      Tentar novamente
                    </button>
                  </div>
                ) : collectionCards.length ===
                  0 ? (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.012] p-12 text-center">
                    <div className="text-5xl">
                      📂
                    </div>

                    <h3 className="mt-4 text-lg font-black">
                      Pasta vazia
                    </h3>

                    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-600">
                      Ainda não existem cartas nesta pasta da sua coleção.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="mb-5 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-700">
                          Suas cartas
                        </p>

                        <p className="mt-1 text-xs text-slate-500">
                          Clique em uma carta para abrir seus detalhes.
                        </p>
                      </div>

                      <span className="rounded-full border border-blue-400/10 bg-blue-500/5 px-3 py-1.5 text-[9px] font-black text-blue-300">
                        {
                          collectionCards.length
                        }{" "}
                        modelos
                      </span>
                    </div>

                    <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {collectionCards.map(
                        (
                          card
                        ) =>
                          renderCard(
                            card,
                            true
                          )
                      )}
                    </div>
                  </>
                )}
              </div>
            </section>
          )}
        </section>

        {/* =================================================
            POKÉMON REGISTRADOS
        ================================================= */}

        <section className="pb-8 sm:pb-10">
          <div className="mb-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                Pokédex
              </p>

              <h2 className="mt-1 break-words text-2xl font-black sm:text-3xl">
                Pokémon registrados
              </h2>

              <p className="mt-1 break-words text-xs text-slate-700">
                Clique em um Pokémon para acompanhar as cartas que você possui.
              </p>
            </div>

            <span className="w-fit shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold text-slate-600">
              {
                registered.length
              }{" "}
              Pokémon
            </span>
          </div>

          {loading ? (
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-12 text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />

              <p className="mt-4 text-sm text-slate-500">
                Carregando sua coleção...
              </p>
            </div>
          ) : error ? (
            <div className="rounded-3xl border border-red-500/20 bg-red-500/10 p-10 text-center">
              <div className="text-4xl">
                ⚠️
              </div>

              <p className="mt-3 break-words text-sm text-red-300">
                {
                  error
                }
              </p>

              <button
                type="button"
                onClick={() =>
                  void loadRegistered()
                }
                className="mt-5 rounded-xl bg-blue-500 px-5 py-2.5 text-sm font-black text-white transition hover:bg-blue-400"
              >
                Tentar novamente
              </button>
            </div>
          ) : filteredRegistered.length ===
            0 ? (
            <div className="rounded-[2rem] border border-blue-500/10 bg-gradient-to-br from-blue-500/[0.04] to-transparent p-10 text-center sm:p-14">
              <div className="text-6xl">
                📖
              </div>

              <h2 className="mt-5 break-words text-2xl font-black">
                Sua Pokédex está vazia
              </h2>

              <p className="mx-auto mt-2 max-w-xl break-words text-sm leading-6 text-slate-600">
                Escaneie um Pokémon ou marque uma carta de Pokémon como “Tenho” para adicioná-lo automaticamente.
              </p>

              <button
                type="button"
                onClick={() =>
                  router.push(
                    "/"
                  )
                }
                className="mt-7 rounded-2xl bg-blue-500 px-7 py-3 font-black text-white transition hover:bg-blue-400"
              >
                📷 Escanear Pokémon
              </button>
            </div>
          ) : (
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {filteredRegistered.map(
                (
                  item
                ) => {
                  const pokemonId =
                    getPokemonId(
                      item
                    );

                  const dex =
                    getDexNumber(
                      item
                    );

                  const image =
                    pokemonAnimatedImage(
                      item
                    );

                  const fallbackImage =
                    pokemonImage(
                      item
                    );

                  const isSelected =
                    selected !==
                      null &&
                    getPokemonId(
                      selected
                    ) ===
                      pokemonId;

                  const cardCount =
                    item.card_count ??
                    0;

                  const ownedQuantity =
                    item.owned_quantity ??
                    0;

                  return (
                    <button
                      key={
                        pokemonId
                      }
                      type="button"
                      onClick={() =>
                        void openRegisteredPokemon(
                          item
                        )
                      }
                      className={`group min-w-0 overflow-hidden rounded-[1.35rem] border bg-[#05070c] text-left shadow-xl shadow-black/25 transition duration-300 hover:-translate-y-1 ${
                        isSelected
                          ? "border-blue-400/50 shadow-blue-500/10"
                          : "border-white/10 hover:border-blue-400/25"
                      }`}
                    >
                      <div className="relative flex h-48 items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_center,rgba(37,99,235,0.10),transparent_62%)] p-4 sm:h-56">
                        {image ? (
                          <img
                            src={
                              image
                            }
                            alt={
                              item.name
                            }
                            className="pokescan-pokemon-motion max-h-full max-w-full object-contain drop-shadow-2xl transition duration-300 group-hover:scale-105"
                            loading="lazy"
                            onError={(event) => {
                              if (
                                fallbackImage &&
                                event.currentTarget.src !== fallbackImage
                              ) {
                                event.currentTarget.src = fallbackImage;
                              } else {
                                event.currentTarget.style.display = "none";
                              }
                            }}
                          />
                        ) : (
                          <div className="text-4xl">
                            🖼️
                          </div>
                        )}

                        <span className="absolute left-3 top-3 rounded-full border border-white/10 bg-black/60 px-2.5 py-1.5 text-[9px] font-black text-slate-400 backdrop-blur">
                          #
                          {
                            String(
                              dex
                            ).padStart(
                              4,
                              "0"
                            )
                          }
                        </span>

                        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
                          <span className="rounded-full bg-blue-500 px-2.5 py-1 text-[9px] font-black text-white shadow-lg">
                            {
                              cardCount
                            }{" "}
                            modelo
                            {
                              cardCount ===
                              1
                                ? ""
                                : "s"
                            }
                          </span>

                          {ownedQuantity >
                            0 && (
                            <span className="rounded-full border border-blue-400/25 bg-blue-500/15 px-2.5 py-1 text-[9px] font-black text-blue-300">
                              {
                                ownedQuantity
                              }{" "}
                              un.
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="border-t border-white/10 p-4">
                        <p className="text-[8px] font-black uppercase tracking-[0.2em] text-blue-400/70">
                          Pokémon
                        </p>

                        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
                          <h3 className="min-w-0 flex-1 truncate text-base font-black text-white">
                            {
                              item.name
                            }
                          </h3>

                          <span className="shrink-0 text-slate-700 transition group-hover:translate-x-1 group-hover:text-blue-300">
                            →
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="rounded-full bg-white/[0.035] px-2 py-1 text-[8px] font-black text-slate-600">
                            {
                              cardCount
                            }{" "}
                            modelos
                          </span>

                          {ownedQuantity >
                            0 && (
                            <span className="rounded-full bg-blue-500/10 px-2 py-1 text-[8px] font-black text-blue-300">
                              {
                                ownedQuantity
                              }{" "}
                              unidades
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                }
              )}
            </div>
          )}
        </section>

        {/* =================================================
            SELECTED POKÉMON
        ================================================= */}

        {selected && (
          <section
            id="selected-pokemon"
            className="mb-10 overflow-hidden rounded-[2rem] border border-white/10 bg-[#05070c] shadow-2xl shadow-black/40 sm:mb-12"
          >
            <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/[0.07] via-transparent to-transparent p-5 sm:p-7">
              <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                      Pokémon selecionado
                    </p>

                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[9px] font-black text-slate-500">
                      {
                        selectedTotalCount
                      }{" "}
                      modelos
                    </span>
                  </div>

                  <h2 className="mt-2 break-words text-3xl font-black tracking-tight sm:text-4xl">
                    {
                      selected.name
                    }
                  </h2>

                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="text-sm font-black text-white">
                      {
                        selectedOwnedCount
                      }{" "}
                      /{" "}
                      {
                        selectedTotalCount
                      }{" "}
                      cartas
                    </p>

                    <span className="text-xs font-bold text-slate-600">
                      {
                        selectedOwnedQuantity
                      }{" "}
                      unidades
                    </span>

                    <span className="text-xs font-bold text-blue-300/70">
                      {
                        selectedPercentage
                      }
                      %
                    </span>
                  </div>

                  <div className="mt-3 max-w-2xl">
                    <div className="h-2.5 overflow-hidden rounded-full border border-white/10 bg-black">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-blue-600 via-blue-400 to-cyan-300 transition-all duration-500"
                        style={{
                          width: `${selectedPercentage}%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.04] px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-blue-300/60">
                      Tenho
                    </p>

                    <p className="mt-1 text-xl font-black text-blue-300">
                      {
                        selectedOwnedCount
                      }
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">
                      Unidades
                    </p>

                    <p className="mt-1 text-xl font-black text-white">
                      {
                        selectedOwnedQuantity
                      }
                    </p>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">
                      Faltam
                    </p>

                    <p className="mt-1 text-xl font-black text-white">
                      {Math.max(
                        0,
                        selectedTotalCount -
                          selectedOwnedCount
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setSelected(
                        null
                      )
                    }
                    className="rounded-2xl border border-white/10 px-4 py-3 text-xs font-bold text-slate-500 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    Fechar
                  </button>
                </div>
              </div>
            </div>

            <div className="p-4 sm:p-7">
              {registeredCardsLoading ? (
                <div className="py-12 text-center">
                  <div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-white/10 border-t-blue-500" />

                  <p className="mt-4 text-sm text-slate-600">
                    Carregando cartas...
                  </p>
                </div>
              ) : registeredCardsError ? (
                <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-8 text-center text-sm text-red-300">
                  {
                    registeredCardsError
                  }
                </div>
              ) : registeredCards.length ===
                0 ? (
                <div className="py-12 text-center text-sm text-slate-600">
                  Nenhuma carta encontrada para este Pokémon.
                </div>
              ) : (
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {registeredCards.map(
                    (
                      card
                    ) =>
                      renderCard(
                        card,
                        true
                      )
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ===================================================
          TRADE MODAL
      =================================================== */}

      {tradingCard && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-md"
          onMouseDown={event => {
            if (
              event.target === event.currentTarget &&
              !tradeSaving
            ) {
              setTradingCard(null);
            }
          }}
        >
          <div className="w-full max-w-md overflow-hidden rounded-[1.75rem] border border-blue-400/20 bg-[#05070d] shadow-[0_40px_100px_rgba(0,0,0,0.8)]">
            <div className="border-b border-white/10 bg-gradient-to-r from-blue-500/[0.10] via-transparent to-transparent p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                    Troca de carta
                  </p>
                  <h3 className="mt-2 truncate text-xl font-black text-white">
                    {tradingCard.name}
                  </h3>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {tradingCard.set?.name || "Coleção não informada"}
                  </p>
                </div>

                <button
                  type="button"
                  disabled={tradeSaving}
                  onClick={() => setTradingCard(null)}
                  className="rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white disabled:opacity-40"
                >
                  ×
                </button>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <div className="rounded-2xl border border-blue-400/10 bg-blue-500/[0.05] p-4">
                <p className="text-[9px] font-black uppercase tracking-widest text-slate-600">
                  Você possui
                </p>
                <p className="mt-2 text-3xl font-black text-blue-300">
                  {getOwnedQuantity(tradingCard)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  unidade(s) desta carta
                </p>
              </div>

              <div>
                <label
                  htmlFor="trade-quantity"
                  className="text-[10px] font-black uppercase tracking-widest text-slate-500"
                >
                  Quantas cartas você vai trocar?
                </label>

                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={
                      tradeSaving ||
                      tradeQuantity <= 1
                    }
                    onClick={() =>
                      setTradeQuantity(current =>
                        Math.max(1, current - 1)
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xl font-black text-slate-300 transition hover:border-blue-400/30 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-30"
                  >
                    −
                  </button>

                  <input
                    id="trade-quantity"
                    type="number"
                    min={1}
                    max={Math.max(
                      1,
                      getOwnedQuantity(tradingCard)
                    )}
                    value={Math.max(
                      1,
                      Math.min(
                        Math.max(
                          1,
                          getOwnedQuantity(tradingCard)
                        ),
                        Math.floor(
                          tradeQuantity
                        ) || 1
                      )
                    )}
                    onChange={event => {
                      const value =
                        Number(
                          event.target.value
                        );

                      setTradeQuantity(
                        Number.isFinite(value)
                          ? Math.max(
                              1,
                              Math.min(
                                Math.max(
                                  1,
                                  getOwnedQuantity(
                                    tradingCard
                                  )
                                ),
                                Math.floor(value)
                              )
                            )
                          : 1
                      );
                    }}
                    disabled={tradeSaving}
                    className="h-12 min-w-0 flex-1 rounded-xl border border-white/10 bg-[#020617] px-4 text-center text-lg font-black text-white outline-none focus:border-blue-400/50"
                  />

                  <button
                    type="button"
                    disabled={
                      tradeSaving ||
                      tradeQuantity >=
                        getOwnedQuantity(
                          tradingCard
                        )
                    }
                    onClick={() =>
                      setTradeQuantity(current =>
                        Math.min(
                          getOwnedQuantity(
                            tradingCard
                          ),
                          current + 1
                        )
                      )
                    }
                    className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-xl font-black text-slate-300 transition hover:border-blue-400/30 hover:bg-blue-500/10 hover:text-blue-300 disabled:opacity-30"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-sm leading-6 text-slate-300">
                  Você está trocando{" "}
                  <span className="font-black text-blue-300">
                    {Math.max(
                      1,
                      Math.min(
                        getOwnedQuantity(tradingCard),
                        Math.floor(
                          tradeQuantity
                        ) || 1
                      )
                    )}
                  </span>{" "}
                  unidade(s).
                </p>

                {getOwnedQuantity(tradingCard) > 0 &&
                  tradeQuantity >=
                    getOwnedQuantity(
                      tradingCard
                    ) && (
                    <p className="mt-2 text-xs leading-5 text-amber-300/80">
                      Você está trocando todas as unidades desta carta. Se ela for a última carta do Pokémon, ele será liberado da Pokédex.
                    </p>
                  )}
              </div>

              {tradeError && (
                <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-300">
                  {tradeError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={tradeSaving}
                  onClick={() =>
                    setTradingCard(null)
                  }
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  disabled={
                    tradeSaving ||
                    getOwnedQuantity(
                      tradingCard
                    ) <= 0
                  }
                  onClick={() =>
                    void tradeOwnedCard(
                      tradingCard
                    )
                  }
                  className="rounded-xl bg-blue-500 px-4 py-3 text-xs font-black text-white transition hover:bg-blue-400 disabled:opacity-50"
                >
                  {tradeSaving
                    ? "Registrando..."
                    : "Confirmar troca"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================
          CARD DETAIL MODAL
      =================================================== */}

      {renderCardDetails()}
    </main>
  );
}