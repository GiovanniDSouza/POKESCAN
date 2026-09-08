import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const image = formData.get("image");

    if (!image) {
      return NextResponse.json(
        {
          success: false,
          error: "Nenhuma imagem foi enviada.",
        },
        {
          status: 400,
        }
      );
    }

    if (!(image instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "O arquivo enviado não é uma imagem válida.",
        },
        {
          status: 400,
        }
      );
    }

    if (!image.type.startsWith("image/")) {
      return NextResponse.json(
        {
          success: false,
          error: "O arquivo enviado precisa ser uma imagem.",
        },
        {
          status: 400,
        }
      );
    }

    console.log("====================================");
    console.log("NOVA IMAGEM RECEBIDA");
    console.log("Nome:", image.name);
    console.log("Tipo:", image.type);
    console.log("Tamanho:", image.size, "bytes");
    console.log("====================================");

    /*
     * POR ENQUANTO:
     *
     * Aqui ainda não vamos usar IA.
     *
     * A próxima etapa será:
     *
     * imagem
     *   ↓
     * reconhecimento da carta
     *   ↓
     * Pokémon
     *   ↓
     * conjunto
     *   ↓
     * número da carta
     *   ↓
     * preço
     */

    return NextResponse.json({
      success: true,
      message: "Imagem recebida com sucesso!",
      image: {
        name: image.name,
        type: image.type,
        size: image.size,
      },
      recognition: {
        status: "pending",
      },
    });
  } catch (error) {
    console.error("Erro no scanner:", error);

    return NextResponse.json(
      {
        success: false,
        error: "Erro interno ao processar a imagem.",
      },
      {
        status: 500,
      }
    );
  }
}
