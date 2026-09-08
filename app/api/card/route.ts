import { NextResponse } from "next/server";
import { DatabaseSync } from "node:sqlite";

/**
 * GET /api/card
 *
 * 1) Without imageUrl: returns the latest cards from the local SQLite DB.
 * 2) With imageUrl: acts as a controlled image proxy for card-candidate images
 *    used by the visual comparison step in page.tsx.
 */
export async function GET(request: Request) {
  let db: DatabaseSync | null = null;

  try {
    const url = new URL(request.url);
    const imageUrl = url.searchParams.get("imageUrl");

    /* =====================================================
       IMAGE PROXY
    ===================================================== */

    if (imageUrl) {
      let target: URL;

      try {
        target = new URL(imageUrl);
      } catch {
        return NextResponse.json(
          {
            success: false,
            error: "URL da imagem inválida.",
          },
          { status: 400 }
        );
      }

      // Hosts currently used by the Pokémon card image sources.
      // Keep this allowlist explicit; do not turn this into an open proxy.
      const allowedHosts = new Set([
        "images.pokemontcg.io",
        "images.pokemontcg.com",
        "images.scrydex.com",
      ]);

      if (!allowedHosts.has(target.hostname)) {
        console.warn(
          "🚫 Host de imagem não permitido:",
          target.hostname
        );

        return NextResponse.json(
          {
            success: false,
            error: "Domínio da imagem não permitido.",
          },
          { status: 403 }
        );
      }

      console.log(
        "🖼️ Proxy de imagem:",
        target.toString()
      );

      let response = await fetch(target.toString(), {
        cache: "no-store",
        headers: {
          Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 PokéScan/1.0",
        },
      });

      // Scrydex pode responder 403. Quando a URL tem o padrão /pokemon/<set>/<number>,
      // tentamos a mesma carta pela CDN pública images.pokemontcg.io.
      if (!response.ok && target.hostname === "images.scrydex.com") {
        const match = target.pathname.match(/^\/pokemon\/([^/]+)\/([^/]+)\//);
        if (match) {
          const fallbackUrl = `https://images.pokemontcg.io/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}_hires.png`;
          console.warn("↩️ Scrydex indisponível; tentando CDN alternativa:", fallbackUrl);
          response = await fetch(fallbackUrl, {
            cache: "no-store",
            headers: {
              Accept: "image/avif,image/webp,image/png,image/*,*/*;q=0.8",
              "User-Agent": "Mozilla/5.0 PokéScan/1.0",
            },
          });
        }
      }

      if (!response.ok) {
        console.error(
          "❌ Falha ao buscar imagem candidata:",
          response.status,
          target.hostname,
          target.pathname
        );

        return NextResponse.json(
          {
            success: false,
            error: `Não foi possível carregar a imagem candidata (${response.status}).`,
          },
          { status: 502 }
        );
      }

      const contentType =
        response.headers.get("content-type") || "image/jpeg";

      const buffer = await response.arrayBuffer();

      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600, s-maxage=3600",
          "X-Pokescan-Image-Proxy": "1",
        },
      });
    }

    /* =====================================================
       LOCAL CARD LIST
    ===================================================== */

    db = new DatabaseSync("pokescan.sqlite");

    const cards = db
      .prepare(`
        SELECT
          cards.id,
          cards.name,
          cards.set_name,
          cards.set_code,
          cards.card_number,
          cards.rarity,
          cards.language,
          cards.image,
          pokemon.national_dex_number,
          pokemon.name AS pokemon_name,
          pokemon.image AS pokemon_image
        FROM cards
        LEFT JOIN pokemon
          ON cards.pokemon_id = pokemon.id
        ORDER BY cards.id DESC
        LIMIT 20
      `)
      .all();

    return NextResponse.json({
      success: true,
      cards,
    });
  } catch (error) {
    console.error("❌ Erro na API /api/card:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Não foi possível consultar as cartas.",
      },
      { status: 500 }
    );
  } finally {
    db?.close();
  }
}
