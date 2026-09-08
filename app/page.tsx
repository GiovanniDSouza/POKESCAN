"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createWorker } from "tesseract.js";

type CardType = "Pokémon" | "Trainer" | "Energy";

// v10: rollback do OCR para a base estável + limpeza da whitelist do Tesseract.

type RecognitionResult = {
  success: boolean;
  recognized: boolean;
  cardResolved?: boolean;
  impressionConfirmed?: boolean;
  priceKind?: "exact" | "reference";
  referenceReason?: string;
  text?: string;
  message?: string;
  cardType?: CardType;
  card?: {
    id: string;
    name: string;
    number: string;
    supertype?: string;
    subtypes?: string[];
    rarity?: string;
    images?: {
      small?: string;
      large?: string;
    };
    set?: {
      id?: string;
      name?: string;
      series?: string;
      releaseDate?: string;
    };
  };
  pokemon?: {
    id: number;
    nationalDexNumber: number;
    name: string;
    image?: string | null;
    type1?: string | null;
    type2?: string | null;
    generation?: number | null;
  } | null;
  prices?: {
    usd?: number;
    brl?: number;
    eur?: number;
  };
  candidates?: Array<{
    id: string;
    name: string;
    number: string;
    supertype?: string;
    subtypes?: string[];
    rarity?: string;
    hp?: string;
    attacks?: { name?: string; text?: string; damage?: string }[];
    abilities?: { name?: string; text?: string }[];
    set?: { id?: string; name?: string; series?: string; releaseDate?: string };
    images?: { small?: string; large?: string };
    tcgplayer?: { updatedAt?: string; prices?: Record<string, { market?: number; low?: number; mid?: number; high?: number }> };
  }>;
  candidateType?: CardType;
  collection?: {
    cardId?: string;
    cardNumber?: string;
    setId?: string | null;
    setName?: string | null;
    setSeries?: string | null;
  };
};

type OCRResult = {
  text: string;
  confidence: number;
};

type EnergyHint =
  | "Grass Energy"
  | "Fire Energy"
  | "Water Energy"
  | "Lightning Energy"
  | "Psychic Energy"
  | "Fighting Energy"
  | "Darkness Energy"
  | "Metal Energy"
  | "Fairy Energy"
  | "Dragon Energy"
  | null;

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RecognitionResult | null>(null);
  const [registered, setRegistered] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [escaped, setEscaped] = useState(false);

  async function startCamera() {
    setError("");
    setCaptured(false);
    setCapturedImage(null);
    setResult(null);
    setRegistered(false);
    setRegistering(false);
    setEscaped(false);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("A câmera não é suportada neste navegador.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      streamRef.current = stream;
      setCameraActive(true);

      requestAnimationFrame(() => {
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        video.muted = true;
        video.playsInline = true;
        video.play().catch((err) => {
          if (err?.name !== "AbortError") {
            console.error("Erro ao reproduzir vídeo:", err);
          }
        });
      });
    } catch (err) {
      console.error(err);
      setCameraActive(false);
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "O navegador bloqueou a câmera. Permita o acesso pelo cadeado do endereço."
          : err instanceof Error
          ? err.message
          : "Não foi possível acessar a câmera."
      );
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
    setCaptured(false);
    setCapturedImage(null);
  }

  function captureCard() {
    setError("");

    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError("A câmera ainda está iniciando. Aguarde alguns segundos.");
      return;
    }

    const sourceWidth = video.videoWidth;
    const sourceHeight = video.videoHeight;

    // Área maior para não exigir que a pessoa deixe a carta tão próxima.
    const cropWidth = Math.floor(sourceWidth * 0.82);
    const cropHeight = sourceHeight;
    const cropX = Math.max(0, Math.floor((sourceWidth - cropWidth) / 2));
    const cropY = 0;

    const canvas = document.createElement("canvas");
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      setError("Não foi possível preparar a imagem.");
      return;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      video,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      cropWidth,
      cropHeight
    );

    setCapturedImage(canvas.toDataURL("image/jpeg", 0.96));
    setCaptured(true);
    setResult(null);
    setRegistered(false);
    setEscaped(false);
  }

  function retakeCard() {
    setCaptured(false);
    setCapturedImage(null);
    setResult(null);
    setRegistered(false);
    setRegistering(false);
    setEscaped(false);
    setError("");
  }

  function preprocessImage(imageSrc: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        if (!ctx) {
          reject(new Error("Não foi possível preparar a imagem."));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );

        for (let i = 0; i < data.data.length; i += 4) {
          const r = data.data[i];
          const g = data.data[i + 1];
          const b = data.data[i + 2];

          let gray = 0.299 * r + 0.587 * g + 0.114 * b;
          gray = (gray - 128) * 1.55 + 128;

          // Suaviza highlights estourados causados por brilho/holografia.
          if (gray > 225) {
            gray = 225 + (gray - 225) * 0.35;
          }

          gray = Math.max(0, Math.min(255, gray));

          data.data[i] = gray;
          data.data[i + 1] = gray;
          data.data[i + 2] = gray;
        }

        ctx.putImageData(data, 0, 0);
        resolve(canvas.toDataURL("image/png"));
      };

      img.onerror = () => reject(new Error("Falha ao processar a imagem."));
      img.src = imageSrc;
    });
  }

  function binarizeImage(imageSrc: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        if (!ctx) {
          reject(new Error("Falha ao preparar contraste binário."));
          return;
        }

        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        );

        for (let i = 0; i < data.data.length; i += 4) {
          const r = data.data[i];
          const g = data.data[i + 1];
          const b = data.data[i + 2];

          const gray = 0.299 * r + 0.587 * g + 0.114 * b;

          /* Preto/branco com limiar relativamente alto para preservar letras escuras. */
          const value = gray > 172 ? 255 : 0;

          data.data[i] = value;
          data.data[i + 1] = value;
          data.data[i + 2] = value;
        }

        ctx.putImageData(data, 0, 0);

        resolve(canvas.toDataURL("image/png"));
      };

      img.onerror = () => reject(new Error("Falha no processamento binário."));
      img.src = imageSrc;
    });
  }

  function rotateAny(
    imageSrc: string,
    degrees: number
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const radians = (degrees * Math.PI) / 180;
        const sin = Math.abs(Math.sin(radians));
        const cos = Math.abs(Math.cos(radians));

        const width = img.naturalWidth;
        const height = img.naturalHeight;

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(width * cos + height * sin);
        canvas.height = Math.ceil(width * sin + height * cos);

        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Falha na rotação fina da imagem."));
          return;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(radians);
        ctx.drawImage(
          img,
          -width / 2,
          -height / 2
        );

        resolve(canvas.toDataURL("image/jpeg", 0.96));
      };

      img.onerror = () => reject(new Error("Falha na rotação fina da imagem."));
      img.src = imageSrc;
    });
  }

  function rotateImage(
    imageSrc: string,
    degrees: 90 | 270
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalHeight;
        canvas.height = img.naturalWidth;

        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Falha na rotação da imagem."));
          return;
        }

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((degrees * Math.PI) / 180);
        ctx.drawImage(
          img,
          -img.naturalWidth / 2,
          -img.naturalHeight / 2
        );

        resolve(canvas.toDataURL("image/jpeg", 0.95));
      };

      img.onerror = () => reject(new Error("Falha na rotação da imagem."));
      img.src = imageSrc;
    });
  }

  function cropTopRegion(imageSrc: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const sourceWidth = img.naturalWidth;
        const sourceHeight = img.naturalHeight;
        const cropHeight = Math.max(
          70,
          Math.floor(sourceHeight * 0.20)
        );

        const scale = Math.min(
          3,
          2600 / sourceWidth
        );

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(sourceWidth * scale);
        canvas.height = Math.floor(cropHeight * scale);

        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Falha ao preparar a região do nome."));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        ctx.drawImage(
          img,
          0,
          0,
          sourceWidth,
          cropHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );

        resolve(canvas.toDataURL("image/jpeg", 0.98));
      };

      img.onerror = () =>
        reject(new Error("Falha ao preparar a região superior da carta."));

      img.src = imageSrc;
    });
  }

  function cropBottomRegion(imageSrc: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const sourceWidth = img.naturalWidth;
        const sourceHeight = img.naturalHeight;
        const cropHeight = Math.max(90, Math.floor(sourceHeight * 0.28));
        const cropY = Math.max(0, sourceHeight - cropHeight);
        const scale = Math.min(3, 2600 / sourceWidth);

        const canvas = document.createElement('canvas');
        canvas.width = Math.floor(sourceWidth * scale);
        canvas.height = Math.floor(cropHeight * scale);

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Falha ao preparar o rodapé da carta.'));
          return;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(
          img,
          0,
          cropY,
          sourceWidth,
          cropHeight,
          0,
          0,
          canvas.width,
          canvas.height
        );

        resolve(canvas.toDataURL('image/jpeg', 0.98));
      };

      img.onerror = () => reject(new Error('Falha ao preparar o rodapé da carta.'));
      img.src = imageSrc;
    });
  }

  async function runTargetedOCR(
    imageSrc: string,
    region: 'header' | 'bottom'
  ): Promise<string> {
    const regionImage =
      region === 'header'
        ? await cropTopRegion(imageSrc)
        : await cropBottomRegion(imageSrc);

    const worker = await createWorker('eng');
    const outputs: string[] = [];

    try {
      for (const psm of ['6', '7', '11']) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          user_defined_dpi: '300',
          tessedit_char_whitelist: '',
        });

        const recognition = await worker.recognize(regionImage);
        const firstText = recognition.data.text?.trim() || '';
        if (firstText) outputs.push(firstText);
      }

      const contrasted = await preprocessImage(regionImage);
      for (const psm of ['6', '7']) {
        await worker.setParameters({
          tessedit_pageseg_mode: psm,
          user_defined_dpi: '300',
          tessedit_char_whitelist: '',
        });

        const recognition = await worker.recognize(contrasted);
        const secondText = recognition.data.text?.trim() || '';
        if (secondText) outputs.push(secondText);
      }
    } finally {
      await worker.terminate();
    }

    const unique = [...new Set(outputs.map((value) => value.trim()).filter(Boolean))];
    const combined = unique.join('\n');

    console.log(
      region === 'header'
        ? '🔤 OCR direcionado do cabeçalho:'
        : '🔢 OCR direcionado do rodapé:',
      combined
    );

    return combined;
  }

  async function detectEnergyVisualHint(
    imageSrc: string
  ): Promise<EnergyHint> {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement("canvas");
        const width = 360;
        const height = Math.max(
          240,
          Math.round((img.naturalHeight / img.naturalWidth) * width)
        );

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d", {
          willReadFrequently: true,
        });

        if (!ctx) {
          resolve(null);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        /*
         * Ignoramos a borda da carta e analisamos o miolo.
         * A Energia Básica normalmente mantém uma cor dominante
         * mesmo quando o símbolo não é reconhecido pelo OCR.
         */
        const left = Math.floor(width * 0.15);
        const right = Math.floor(width * 0.85);
        const top = Math.floor(height * 0.25);
        const bottom = Math.floor(height * 0.82);

        const data = ctx.getImageData(
          left,
          top,
          right - left,
          bottom - top
        ).data;

        let hueSum = 0;
        let satSum = 0;
        let valueSum = 0;
        let samples = 0;

        function rgbToHsv(
          r: number,
          g: number,
          b: number
        ) {
          r /= 255;
          g /= 255;
          b /= 255;

          const max = Math.max(r, g, b);
          const min = Math.min(r, g, b);
          const delta = max - min;

          let h = 0;

          if (delta !== 0) {
            if (max === r) {
              h = ((g - b) / delta) % 6;
            } else if (max === g) {
              h = (b - r) / delta + 2;
            } else {
              h = (r - g) / delta + 4;
            }

            h /= 6;
            if (h < 0) h += 1;
          }

          const s = max === 0 ? 0 : delta / max;
          return { h, s, v: max };
        }

        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];

          const hsv = rgbToHsv(r, g, b);

          if (
            hsv.s < 0.28 ||
            hsv.v < 0.18 ||
            hsv.v > 0.98
          ) {
            continue;
          }

          hueSum += hsv.h;
          satSum += hsv.s;
          valueSum += hsv.v;
          samples++;
        }

        if (samples < 30) {
          resolve(null);
          return;
        }

        const hue = hueSum / samples;
        const saturation = satSum / samples;
        const value = valueSum / samples;

        console.log(
          "🎨 Análise visual da energia:",
          `h=${hue.toFixed(3)}`,
          `s=${saturation.toFixed(3)}`,
          `v=${value.toFixed(3)}`
        );

        /*
         * Só emitimos uma dica quando a cor é suficientemente
         * dominante. A API continua exigindo que o OCR marque a
         * carta como Energy antes de usar essa dica.
         */
        if (hue >= 0.20 && hue <= 0.45 && saturation >= 0.32) {
          resolve("Grass Energy");
          return;
        }

        if (
          (hue <= 0.06 || hue >= 0.96) &&
          saturation >= 0.38 &&
          value >= 0.35
        ) {
          resolve("Fire Energy");
          return;
        }

        if (
          hue >= 0.48 &&
          hue <= 0.72 &&
          saturation >= 0.30
        ) {
          resolve("Water Energy");
          return;
        }

        if (
          hue >= 0.08 &&
          hue <= 0.18 &&
          saturation >= 0.30 &&
          value >= 0.35
        ) {
          resolve("Lightning Energy");
          return;
        }

        if (
          hue >= 0.72 &&
          hue <= 0.92 &&
          saturation >= 0.28
        ) {
          resolve("Psychic Energy");
          return;
        }

        if (
          hue > 0.90 &&
          saturation >= 0.25
        ) {
          resolve("Fairy Energy");
          return;
        }

        resolve(null);
      };

      img.onerror = () => resolve(null);
      img.src = imageSrc;
    });
  }

  function makeCompactServerImage(
    imageSrc: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const maxWidth = 1200;
        const scale = Math.min(
          1,
          maxWidth / img.naturalWidth
        );

        const canvas = document.createElement("canvas");
        canvas.width = Math.max(
          1,
          Math.floor(img.naturalWidth * scale)
        );
        canvas.height = Math.max(
          1,
          Math.floor(img.naturalHeight * scale)
        );

        const ctx = canvas.getContext("2d");

        if (!ctx) {
          reject(new Error("Falha ao compactar a imagem da carta."));
          return;
        }

        ctx.drawImage(
          img,
          0,
          0,
          canvas.width,
          canvas.height
        );

        resolve(
          canvas.toDataURL("image/jpeg", 0.72)
        );
      };

      img.onerror = () =>
        reject(new Error("Falha ao compactar a imagem da carta."));

      img.src = imageSrc;
    });
  }

  async function runOCR(imageSrc: string) {
    const processed = await preprocessImage(imageSrc);
    const rotated90 = await rotateImage(imageSrc, 90);
    const rotated270 = await rotateImage(imageSrc, 270);
    const processed90 = await rotateImage(processed, 90);
    const processed270 = await rotateImage(processed, 270);
    const topName = await cropTopRegion(imageSrc);
    const topNameContrast = await preprocessImage(topName);
    const topNameBinary = await binarizeImage(topNameContrast);
    const topNameMinus = await rotateAny(topNameBinary, -4);
    const topNamePlus = await rotateAny(topNameBinary, 4);

    const variants = [
      { name: "original", image: imageSrc, psm: "6" },
      { name: "contraste", image: processed, psm: "6" },
      { name: "original-90", image: rotated90, psm: "6" },
      { name: "original-270", image: rotated270, psm: "6" },
      { name: "contraste-90", image: processed90, psm: "6" },
      { name: "contraste-270", image: processed270, psm: "6" },
      { name: "nome-superior", image: topName, psm: "7" },
      { name: "nome-superior-contraste", image: topNameContrast, psm: "7" },
      { name: "nome-superior-binario", image: topNameBinary, psm: "7" },
      { name: "nome-superior-binario-4graus", image: topNamePlus, psm: "7" },
      { name: "nome-superior-binario-menos4graus", image: topNameMinus, psm: "7" },
    ];

    const worker = await createWorker("eng");
    const results: OCRResult[] = [];

    try {
      for (const variant of variants) {
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: variant.psm,
            user_defined_dpi: "300",
            // Tesseract mantém parâmetros entre as leituras.
            // Limpamos a whitelist em leituras normais para não
            // deixar uma leitura do cabeçalho contaminar o OCR geral.
            tessedit_char_whitelist: variant.name.startsWith("nome-superior")
              ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789- ."
              : "",
          });

          console.log(`🔍 OCR: ${variant.name}`);
          const recognition = await worker.recognize(variant.image);
          const text = recognition.data.text?.trim() || "";
          const confidence = Number(recognition.data.confidence || 0);

          console.log(
            `📝 ${variant.name} - confiança ${confidence.toFixed(1)}`
          );
          console.log(text);

          if (text) results.push({ text, confidence });
        } catch (error) {
          console.warn(`Falha OCR ${variant.name}:`, error);
        }
      }
    } finally {
      await worker.terminate();
    }

    if (!results.length) {
      throw new Error(
        "Não consegui ler a carta. Melhore a iluminação e mantenha a carta inteira visível."
      );
    }

    results.sort((a, b) => b.confidence - a.confidence);

    return results
      .map((item) => item.text)
      .join("\n");
  }


  function candidateImageUrls(candidate: NonNullable<RecognitionResult["candidates"]>[number]) {
    const urls: string[] = [];
    if (candidate.images?.large) urls.push(candidate.images.large);
    if (candidate.images?.small) urls.push(candidate.images.small);

    // Fallback determinístico para cartas que chegam com imagem Scrydex bloqueada.
    const setId = candidate.set?.id;
    const number = candidate.number;
    if (setId && number) {
      const pokemonTcg = `https://images.pokemontcg.io/${encodeURIComponent(setId)}/${encodeURIComponent(number)}_hires.png`;
      if (!urls.includes(pokemonTcg)) urls.push(pokemonTcg);
      const pokemonTcgSmall = `https://images.pokemontcg.io/${encodeURIComponent(setId)}/${encodeURIComponent(number)}.png`;
      if (!urls.includes(pokemonTcgSmall)) urls.push(pokemonTcgSmall);
    }

    return urls;
  }

  function proxiedImage(url?: string) {
    if (!url) return "";
    return `/api/card?imageUrl=${encodeURIComponent(url)}`;
  }

  function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Não foi possível carregar imagem candidata."));
      img.src = src;
    });
  }

  function descriptorFromCanvas(
    canvas: HTMLCanvasElement,
    gridW = 24,
    gridH = 36
  ) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const values: number[] = [];
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const x = Math.min(canvas.width - 1, Math.floor((gx + 0.5) * canvas.width / gridW));
        const y = Math.min(canvas.height - 1, Math.floor((gy + 0.5) * canvas.height / gridH));
        const idx = (y * canvas.width + x) * 4;
        values.push(
          0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]
        );
      }
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const std = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length) || 1;
    return values.map((v) => (v - mean) / std);
  }

  function cropCenteredToCard(
    img: HTMLImageElement,
    rotate: 0 | 90 | 270
  ) {
    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const canvas = document.createElement("canvas");
    const source = document.createElement("canvas");
    const sctx = source.getContext("2d");
    if (!sctx) return null;

    if (rotate !== 0) {
      source.width = height;
      source.height = width;
      sctx.translate(source.width / 2, source.height / 2);
      sctx.rotate((rotate * Math.PI) / 180);
      sctx.drawImage(img, -width / 2, -height / 2);
      width = source.width;
      height = source.height;
    } else {
      source.width = width;
      source.height = height;
      sctx.drawImage(img, 0, 0);
    }

    // Carta Pokémon é aproximadamente 0,69 de largura/altura.
    const targetAspect = 0.69;
    let cropW = width;
    let cropH = width / targetAspect;
    if (cropH > height) {
      cropH = height;
      cropW = height * targetAspect;
    }

    // Em fotos da câmera, usa uma área central ligeiramente menor para remover mão/fundo.
    cropW *= 0.92;
    cropH *= 0.96;

    const x = Math.max(0, (width - cropW) / 2);
    const y = Math.max(0, (height - cropH) / 2);

    canvas.width = 240;
    canvas.height = 348;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(source, x, y, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function descriptorDistance(a: number[], b: number[]) {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      sum += Math.abs(a[i] - b[i]);
    }
    return sum / a.length;
  }

  function colorHistogramFromCanvas(
    canvas: HTMLCanvasElement,
    bins = 12
  ) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const histogram = new Array(bins * 3).fill(0);
    const step = 4;

    for (let i = 0; i < data.length; i += step * 4) {
      histogram[Math.min(bins - 1, Math.floor((data[i] / 256) * bins))]++;
      histogram[bins + Math.min(bins - 1, Math.floor((data[i + 1] / 256) * bins))]++;
      histogram[bins * 2 + Math.min(bins - 1, Math.floor((data[i + 2] / 256) * bins))]++;
    }

    const total = histogram.reduce((a, b) => a + b, 0) || 1;
    return histogram.map((v) => v / total);
  }

  function edgeDescriptorFromCanvas(
    canvas: HTMLCanvasElement,
    gridW = 24,
    gridH = 36
  ) {
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const small = document.createElement("canvas");
    small.width = gridW;
    small.height = gridH;
    const sctx = small.getContext("2d", { willReadFrequently: true });
    if (!sctx) return null;

    sctx.drawImage(canvas, 0, 0, gridW, gridH);
    const data = sctx.getImageData(0, 0, gridW, gridH).data;
    const gray = new Array(gridW * gridH);

    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const i = (y * gridW + x) * 4;
        gray[y * gridW + x] =
          0.299 * data[i] +
          0.587 * data[i + 1] +
          0.114 * data[i + 2];
      }
    }

    const edges: number[] = [];
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const here = gray[y * gridW + x];
        const right = gray[y * gridW + Math.min(gridW - 1, x + 1)];
        const down = gray[Math.min(gridH - 1, y + 1) * gridW + x];
        edges.push(Math.min(255, Math.abs(here - right) + Math.abs(here - down)) / 255);
      }
    }

    return edges;
  }

  function cropArtRegionFromCardCanvas(canvas: HTMLCanvasElement) {
    const art = document.createElement("canvas");
    art.width = 240;
    art.height = 150;
    const ctx = art.getContext("2d");
    if (!ctx) return null;

    // A área de ilustração é a melhor parte para diferenciar impressões
    // da mesma espécie, enquanto o texto e a moldura permanecem muito parecidos.
    ctx.drawImage(
      canvas,
      0,
      Math.floor(canvas.height * 0.17),
      canvas.width,
      Math.floor(canvas.height * 0.43),
      0,
      0,
      art.width,
      art.height
    );

    return art;
  }

  function histogramDistance(a: number[], b: number[]) {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  function normalizeEvidenceText(text: string) {
    return normalizeLoose(text)
      .replace(/\bgancha?\b/gi, "hook")
      .replace(/\bgancho\b/gi, "hook")
      .replace(/\bfrio\b/gi, "chill")
      .replace(/\brespiracao de gelo\b/gi, "ice breath")
      .replace(/\brespiracao\b/gi, "breath")
      .replace(/\bchamas do reviver\b/gi, "revive flames")
      .replace(/\benergia basica\b/gi, "basic energy")
      .replace(/\benergia\b/gi, "energy");
  }

  function extractOcrNumbers(text: string) {
    return [...new Set((text.match(/\b\d{1,3}\b/g) || []).map(Number))];
  }

  function candidateEvidenceScore(
    candidate: NonNullable<RecognitionResult["candidates"]>[number],
    ocrText: string
  ) {
    const evidence = normalizeEvidenceText(ocrText);
    const numbers = extractOcrNumbers(ocrText);
    let score = 0;
    const reasons: string[] = [];

    const candidateName = normalizeEvidenceText(candidate.name || "");
    if (candidateName && evidence.includes(candidateName)) {
      score += 0.30;
      reasons.push("nome");
    }

    const hp = Number.parseInt(String(candidate.hp || ""), 10);
    if (Number.isFinite(hp) && numbers.includes(hp)) {
      score += 0.28;
      reasons.push(`HP ${hp}`);
    }

    const attacks = candidate.attacks || [];
    let bestAttack = 0;
    for (const attack of attacks) {
      const attackName = normalizeEvidenceText(attack.name || "");
      if (!attackName) continue;
      if (evidence.includes(attackName)) bestAttack = Math.max(bestAttack, 1);
      else {
        const words = attackName.split(/\s+/).filter(Boolean);
        const hits = words.filter((word) => evidence.includes(word)).length;
        if (words.length && hits / words.length >= 0.6) bestAttack = Math.max(bestAttack, 0.7);
      }
    }
    if (bestAttack > 0) {
      score += 0.22 * bestAttack;
      reasons.push("ataque");
    }

    const setName = normalizeEvidenceText(candidate.set?.name || "");
    if (setName && evidence.includes(setName)) {
      score += 0.10;
      reasons.push("coleção");
    }

    return { score, reasons };
  }

  async function findBestVisualCandidate(
    imageSrc: string,
    candidates: NonNullable<RecognitionResult["candidates"]>,
    ocrText: string
  ) {
    if (!candidates.length) return null;

    const captured = await loadImage(imageSrc);
    let best: { id: string; score: number } | null = null;

    const capturedVariants = [0, 90, 270].map((rotate) => {
      const canvas = cropCenteredToCard(captured, rotate as 0 | 90 | 270);
      if (!canvas) return null;

      const art = cropArtRegionFromCardCanvas(canvas);
      return {
        full: descriptorFromCanvas(canvas),
        art: art ? descriptorFromCanvas(art) : null,
        edge: art ? edgeDescriptorFromCanvas(art) : null,
        color: art ? colorHistogramFromCanvas(art) : null,
      };
    }).filter(Boolean) as Array<{
      full: number[] | null;
      art: number[] | null;
      edge: number[] | null;
      color: number[] | null;
    }>;

    const ranked: Array<{ id: string; score: number; visualScore: number; evidenceScore: number; reasons: string[] }> = [];

    for (const candidate of candidates) {
      const urls = candidateImageUrls(candidate);
      if (!urls.length) continue;

      try {
        let candidateImage: HTMLImageElement | null = null;
        let lastError: unknown = null;

        for (const url of urls) {
          try {
            candidateImage = await loadImage(proxiedImage(url));
            console.log("🖼️ Imagem candidata carregada:", candidate.id, url);
            break;
          } catch (err) {
            lastError = err;
          }
        }

        if (!candidateImage) {
          throw lastError instanceof Error ? lastError : new Error("Imagem candidata indisponível.");
        }

        const candidateCanvas = cropCenteredToCard(candidateImage, 0);
        if (!candidateCanvas) continue;

        const candidateArt = cropArtRegionFromCardCanvas(candidateCanvas);
        const candidateFull = descriptorFromCanvas(candidateCanvas);
        const candidateArtDescriptor = candidateArt ? descriptorFromCanvas(candidateArt) : null;
        const candidateEdge = candidateArt ? edgeDescriptorFromCanvas(candidateArt) : null;
        const candidateColor = candidateArt ? colorHistogramFromCanvas(candidateArt) : null;
        if (!candidateFull || !candidateArtDescriptor || !candidateEdge || !candidateColor) continue;

        let bestScore = -Infinity;
        let bestParts = { full: Infinity, art: Infinity, edge: Infinity, color: Infinity };

        for (const variant of capturedVariants) {
          if (!variant.full || !variant.art || !variant.edge || !variant.color) continue;
          const fullDistance = descriptorDistance(variant.full, candidateFull);
          const artDistance = descriptorDistance(variant.art, candidateArtDescriptor);
          const edgeDistance = descriptorDistance(variant.edge, candidateEdge);
          const colorDistance = histogramDistance(variant.color, candidateColor);

          const fullScore = 1 / (1 + fullDistance);
          const artScore = 1 / (1 + artDistance);
          const edgeScore = 1 / (1 + edgeDistance);
          const colorScore = 1 / (1 + colorDistance * 8);
          const visualCombined =
            fullScore * 0.20 +
            artScore * 0.45 +
            edgeScore * 0.20 +
            colorScore * 0.15;

          if (visualCombined > bestScore) {
            bestScore = visualCombined;
            bestParts = { full: fullDistance, art: artDistance, edge: edgeDistance, color: colorDistance };
          }
        }

        console.log(
          "🖼️ Candidata",
          candidate.id,
          "score", bestScore.toFixed(4),
          "art", bestParts.art.toFixed(4),
          "edge", bestParts.edge.toFixed(4),
          "cor", bestParts.color.toFixed(4)
        );

        if (Number.isFinite(bestScore)) {
          const evidence = candidateEvidenceScore(candidate, ocrText);
          const hybridScore = Math.min(1, bestScore * 0.55 + evidence.score);
          console.log(
            "🧠 Evidência", candidate.id,
            "score", evidence.score.toFixed(4),
            evidence.reasons.join(", ") || "nenhuma"
          );
          ranked.push({
            id: candidate.id,
            score: hybridScore,
            visualScore: bestScore,
            evidenceScore: evidence.score,
            reasons: evidence.reasons,
          });
        }
      } catch (err) {
        console.warn("Falha comparação visual:", candidate.id, err);
      }
    }

    ranked.sort((a, b) => b.score - a.score);
    if (!ranked.length) return null;

    const top = ranked[0];
    const second = ranked[1];
    const margin = second ? top.score - second.score : top.score;

    console.log(
      "🖼️ Ranking visual:",
      ranked.slice(0, 5),
      "margem",
      margin.toFixed(4)
    );

    // Não escolhemos uma impressão só porque foi a primeira ou porque
    // ganhou por uma diferença mínima. Isso evita mostrar preço de outra coleção.
    const strongEvidence = top.evidenceScore >= 0.28;
    if ((top.score < 0.50 && !strongEvidence) || (margin < 0.015 && !strongEvidence)) {
      console.warn(
        "⚠️ Comparação visual inconclusiva:",
        `score=${top.score.toFixed(4)}`,
        `margem=${margin.toFixed(4)}`
      );
      return null;
    }

    return top;
  }

  async function recognizeCard() {
    if (!capturedImage) {
      setError("Capture uma carta primeiro.");
      return;
    }

    setError("");
    setRecognizing(true);
    setResult(null);
    setRegistered(false);
    setRegistering(false);
    setEscaped(false);

    try {
      const text = await runOCR(capturedImage);
      const headerText = await runTargetedOCR(capturedImage, 'header');
      const bottomText = await runTargetedOCR(capturedImage, 'bottom');

      const combinedOCR = [text, headerText, bottomText].filter(Boolean).join('\n');

      const energyHint =
        /\b(energy|energia|energi|basica|basic)\b/i.test(combinedOCR)
          ? await detectEnergyVisualHint(capturedImage)
          : null;

      if (energyHint) {
        console.log(
          "🌿 Dica visual detectada:",
          energyHint
        );
      }

      const compactImage = await makeCompactServerImage(
        capturedImage
      );

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          image: compactImage,
          energyHint,
          headerText,
          bottomText,
        }),
      });

      let data = (await response.json()) as RecognitionResult;

      console.log("📦 Resultado /api/scan:", data);

      // O servidor agora devolve uma impressão de referência quando a espécie
      // foi reconhecida mas a impressão exata ainda não foi confirmada.
      // Não tentamos mais promover uma candidata visualmente no cliente,
      // porque isso pode transformar uma referência em uma falsa confirmação.

      setResult(data);

      if (!response.ok || !data.success) {
        throw new Error(
          data.message ||
            (data as RecognitionResult & { error?: string }).error ||
            "Não foi possível processar o reconhecimento."
        );
      }

      if (!data.recognized) {
        setError(data.message || "Carta não identificada.");
      }
    } catch (err) {
      console.error("❌ Erro no reconhecimento:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao reconhecer a carta."
      );
    } finally {
      setRecognizing(false);
    }
  }

  async function registerPokemon() {
    const pokemonId = result?.pokemon?.id;

    if (!pokemonId) {
      setError("Esta carta não corresponde a um Pokémon registrável na Pokédex.");
      return;
    }

    try {
      setError("");
      setRegistering(true);

      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "register",
          pokemonId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Não foi possível registrar o Pokémon.");
      }

      setRegistered(Boolean(data.registered));
      setEscaped(false);

      if (data.alreadyRegistered) {
        console.log("📖 Pokémon já estava na Pokédex:", data.pokemon?.name);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao registrar na Pokédex."
      );
    } finally {
      setRegistering(false);
    }
  }

  function escapePokemon() {
    setEscaped(true);
    setRegistered(false);
    setError("");
  }

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function formatPrice(value: number | undefined, currency: string) {
    if (typeof value !== "number") return "Não disponível";

    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(value);
  }

  const cardType = result?.cardType ||
    (result?.card?.supertype as CardType | undefined) ||
    (result?.pokemon ? "Pokémon" : undefined);

  const currentStep = result?.recognized
    ? cardType === "Pokémon" && !registered && !escaped
      ? 3
      : 4
    : captured
    ? 2
    : 1;

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-[#010308] text-white">
      {/* BACKGROUND */}

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-40 top-10 h-96 w-96 rounded-full bg-blue-500/[0.04] blur-[120px]" />
        <div className="absolute right-[-120px] top-[30%] h-[28rem] w-[28rem] rounded-full bg-cyan-400/[0.025] blur-[130px]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 rounded-full bg-blue-600/[0.02] blur-[120px]" />
      </div>

      <div className="relative mx-auto min-h-screen w-full max-w-[1450px] px-2.5 py-3 sm:px-5 sm:py-5 md:px-6 lg:px-8">
        {/* HEADER */}

        <header className="flex items-center justify-between gap-2 border-b border-white/[0.08] pb-4 sm:gap-3 sm:pb-5">
          <button
            type="button"
            onClick={() => router.push("/")}
            className="group flex min-w-0 items-center gap-3 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 sm:h-11 sm:w-11 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/[0.08] text-xl text-blue-400 transition group-hover:border-blue-400/40 group-hover:bg-blue-500/[0.14]">
              ⚡
            </span>

            <span className="min-w-0">
              <span className="block truncate text-base font-black tracking-tight sm:text-xl">
                POKÉSCAN
              </span>

              <span className="block truncate text-xs text-slate-500">
                Scanner inteligente
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => router.push("/pokedex")}
            className="shrink-0 rounded-xl border border-blue-400/20 bg-blue-500/[0.05] px-2.5 py-2 text-[9px] font-black text-blue-400 sm:px-3 sm:text-[10px] transition hover:border-blue-400/40 hover:bg-blue-500/10 sm:px-4 sm:py-2.5 sm:text-xs"
          >
            ← Minha Pokédex
          </button>
        </header>

        {/* HERO */}

        <section className="pt-6 sm:pt-8 lg:pt-10">
          <div className="overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))] p-4 shadow-2xl shadow-black/40 sm:p-6 lg:p-8">
            <div className="flex min-w-0 flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
              <div className="min-w-0 max-w-3xl">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-400/15 bg-blue-500/[0.06] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                  <span>◆</span>
                  Scanner
                </div>

                <h1 className="mt-4 break-words text-2xl font-black leading-tight tracking-tight sm:text-4xl lg:text-5xl">
                  Descubra quanto vale{" "}
                  <span className="text-blue-400">
                    sua carta
                  </span>
                </h1>

                <p className="mt-3 max-w-2xl break-words text-xs leading-5 text-slate-500 sm:text-base sm:leading-6">
                  Enquadre a carta, capture uma foto e deixe o PokéScan
                  identificar a impressão, consultar o valor e, quando for
                  Pokémon, registrar a espécie na sua Pokédex.
                </p>
              </div>

              <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-3 py-2.5 sm:min-w-[128px] sm:px-5 sm:py-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-slate-700">
                    Etapa
                  </p>

                  <p className="mt-1 text-2xl font-black text-white">
                    {currentStep}
                    <span className="text-sm text-slate-600">/4</span>
                  </p>
                </div>

                <div className="rounded-2xl border border-blue-400/15 bg-blue-500/[0.05] px-3 py-2.5 sm:min-w-[128px] sm:px-5 sm:py-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-blue-400/70">
                    Status
                  </p>

                  <p className="mt-1 text-sm font-black text-blue-300">
                    {recognizing
                      ? "Analisando"
                      : captured
                      ? "Capturada"
                      : cameraActive
                      ? "Online"
                      : "Pronta"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* STEPPER */}

        <section className="py-4 sm:py-6">
          <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 rounded-2xl border border-white/[0.07] bg-[#05080f] px-2.5 py-2.5 sm:gap-4 sm:px-5 sm:py-4">
            <Step
              number="1"
              label="Escanear"
              active={currentStep === 1}
              done={!!result?.recognized}
            />
            <StepLine />
            <Step
              number="2"
              label="Identificar"
              active={currentStep === 2}
              done={!!result?.recognized}
            />
            <StepLine />
            <Step
              number="3"
              label="Valor"
              active={currentStep === 3}
              done={!!result?.recognized}
            />
            <StepLine />
            <Step
              number="4"
              label="Pokédex"
              active={currentStep === 4}
              done={registered}
            />
          </div>
        </section>

        {/* SCANNER */}

        <section>
          <div className="overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[#05080f] shadow-2xl shadow-black/40">
            <div className="flex flex-col gap-4 border-b border-white/[0.08] bg-gradient-to-r from-blue-500/[0.08] via-transparent to-transparent px-4 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                  Captura
                </p>

                <h2 className="mt-1 text-xl font-black sm:text-2xl">
                  Scanner de cartas
                </h2>

                <p className="mt-1 text-xs text-slate-600">
                  {cameraActive
                    ? "Câmera ativa e pronta para capturar."
                    : captured
                    ? "Imagem capturada. Revise antes de reconhecer."
                    : "Ative a câmera para começar."}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    cameraActive
                      ? "bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.45)]"
                      : "bg-slate-700"
                  }`}
                />

                <span className="text-xs font-bold text-slate-500">
                  {cameraActive ? "Online" : "Offline"}
                </span>
              </div>
            </div>

            <div className="grid min-w-0 lg:grid-cols-[1.35fr_0.65fr]">
              <div className="border-b border-white/[0.08] lg:border-b-0 lg:border-r">
                <div className="relative min-h-[360px] sm:min-h-[520px] lg:min-h-[650px] overflow-hidden bg-black sm:min-h-[520px] lg:min-h-[650px]">
                  {capturedImage ? (
                    <div className="relative h-full min-h-[360px] sm:min-h-[520px] lg:min-h-[650px] w-full sm:min-h-[520px] lg:min-h-[650px]">
                      <img
                        src={capturedImage}
                        alt="Carta Pokémon capturada"
                        className="h-full w-full object-contain"
                      />

                      <div className="absolute left-1/2 top-5 -translate-x-1/2 rounded-full border border-emerald-400/25 bg-black/75 px-4 py-2 text-xs font-black text-emerald-300 shadow-xl backdrop-blur sm:text-sm">
                        ✓ Carta capturada
                      </div>

                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 to-transparent" />

                      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-black/65 px-4 py-2 text-center text-[10px] font-bold text-slate-300 backdrop-blur sm:text-xs">
                        Revise a foto e reconheça a carta
                      </div>
                    </div>
                  ) : cameraActive ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full min-h-[360px] sm:min-h-[520px] lg:min-h-[650px] w-full object-cover sm:min-h-[520px] lg:min-h-[650px]"
                      />

                      <div className="pointer-events-none absolute inset-0 bg-black/20" />

                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8">
                        <div className="relative h-[78%] w-[76%] sm:h-[84%] sm:w-[62%] rounded-[1.75rem] border-2 border-blue-400/85 shadow-[0_0_55px_rgba(59,130,246,0.20)]">
                          <span className="absolute -top-11 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-blue-400/15 bg-black/75 px-4 py-2 text-[10px] font-black text-blue-300 backdrop-blur">
                            Centralize a carta aqui
                          </span>

                          <div className="absolute -left-[2px] -top-[2px] h-9 w-9 rounded-tl-3xl border-l-4 border-t-4 border-blue-300" />
                          <div className="absolute -right-[2px] -top-[2px] h-9 w-9 rounded-tr-3xl border-r-4 border-t-4 border-blue-300" />
                          <div className="absolute -bottom-[2px] -left-[2px] h-9 w-9 rounded-bl-3xl border-b-4 border-l-4 border-blue-300" />
                          <div className="absolute -bottom-[2px] -right-[2px] h-9 w-9 rounded-br-3xl border-b-4 border-r-4 border-blue-300" />
                        </div>
                      </div>

                      <div className="absolute bottom-4 left-1/2 w-[calc(100%-1rem)] sm:w-[calc(100%-2rem)] -translate-x-1/2 rounded-2xl border border-white/10 bg-black/70 px-3 py-2.5 text-center text-[9px] sm:px-4 sm:py-3 sm:text-[10px] font-bold leading-5 text-slate-300 backdrop-blur sm:text-xs">
                        Mantenha a carta reta e incline levemente para reduzir reflexos
                      </div>
                    </>
                  ) : (
                    <div className="flex min-h-[360px] sm:min-h-[520px] lg:min-h-[650px] flex-col items-center justify-center bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.10),transparent_60%)] px-6 text-center sm:min-h-[520px] lg:min-h-[650px]">
                      <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-blue-400/15 bg-blue-500/[0.06] text-4xl text-blue-300 shadow-2xl shadow-blue-500/10">
                        📷
                      </div>

                      <h3 className="mt-5 text-xl font-black">
                        Scanner de cartas
                      </h3>

                      <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                        Ative a câmera, posicione a carta dentro do enquadramento
                        e capture uma imagem com boa iluminação.
                      </p>
                    </div>
                  )}
                </div>

                <div className="border-t border-white/[0.08] bg-[#03060b] px-3 py-3 sm:px-6 sm:py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                    {!cameraActive && !captured ? (
                      <button
                        type="button"
                        onClick={startCamera}
                        className="w-full rounded-2xl bg-blue-500 px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 sm:w-auto"
                      >
                        📷 Abrir câmera
                      </button>
                    ) : captured ? (
                      <>
                        <button
                          type="button"
                          onClick={recognizeCard}
                          disabled={recognizing}
                          className="w-full rounded-2xl bg-blue-500 px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          {recognizing
                            ? "🔎 Analisando..."
                            : "🔎 Reconhecer carta"}
                        </button>

                        <button
                          type="button"
                          onClick={retakeCard}
                          disabled={recognizing}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50 sm:w-auto"
                        >
                          🔄 Tirar outra foto
                        </button>

                        <button
                          type="button"
                          onClick={stopCamera}
                          disabled={recognizing}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white disabled:opacity-50 sm:w-auto"
                        >
                          Fechar câmera
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={captureCard}
                          className="w-full rounded-2xl bg-blue-500 px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-white shadow-lg shadow-blue-500/20 transition hover:bg-blue-400 sm:w-auto"
                        >
                          📸 Capturar carta
                        </button>

                        <button
                          type="button"
                          onClick={stopCamera}
                          className="w-full rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3.5 text-sm sm:w-auto sm:px-7 font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white sm:w-auto"
                        >
                          Fechar câmera
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              <aside className="bg-[#04070c] p-3 sm:p-6">
                <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3.5 sm:p-5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">
                    Como funciona
                  </p>

                  <div className="mt-4 space-y-4">
                    <div className="flex gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-[10px] font-black text-blue-300">
                        01
                      </span>

                      <div>
                        <p className="text-sm font-black text-white">
                          Centralize a carta
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          Evite cortar bordas, nome ou número da impressão.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-[10px] font-black text-blue-300">
                        02
                      </span>

                      <div>
                        <p className="text-sm font-black text-white">
                          Capture com boa luz
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          Menos reflexo ajuda o OCR e a confirmação da impressão.
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-[10px] font-black text-blue-300">
                        03
                      </span>

                      <div>
                        <p className="text-sm font-black text-white">
                          Reconheça
                        </p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">
                          O scanner cruza OCR, dados da carta e confirmação da impressão.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-blue-400/10 bg-blue-500/[0.035] p-3.5 sm:p-5">
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">
                    Atalhos
                  </p>

                  <div className="mt-3 grid gap-2">
                    <button
                      type="button"
                      onClick={() => router.push("/pokedex")}
                      className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3 text-left transition hover:border-blue-400/20 hover:bg-blue-500/[0.05]"
                    >
                      <p className="text-xs font-black text-white">
                        📖 Minha Pokédex
                      </p>
                      <p className="mt-1 text-[10px] text-slate-600">
                        Veja suas espécies registradas.
                      </p>
                    </button>

                    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                      <p className="text-xs font-black text-white">
                        💰 Valores
                      </p>
                      <p className="mt-1 text-[10px] text-slate-600">
                        Os preços aparecem após o reconhecimento.
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-300">
              ⚠️ {error}
            </div>
          )}

          {recognizing && (
            <div className="mt-4 rounded-2xl border border-blue-400/20 bg-blue-500/[0.05] p-5 text-center sm:p-6">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-blue-400/20 bg-blue-500/10 text-xl text-blue-300">
                🔎
              </div>

              <p className="mt-3 font-black text-blue-300">
                Analisando carta...
              </p>

              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
                Testando diferentes versões da imagem e identificando o tipo,
                espécie e impressão da carta.
              </p>
            </div>
          )}

          {result && !result.recognized && !recognizing && (
            <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.06] p-4 sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-[0.22em] text-amber-300">
                    Reconhecimento
                  </p>

                  <h3 className="mt-1 text-xl font-black text-white">
                    Carta não identificada
                  </h3>

                  <p className="mt-1 text-sm text-slate-500">
                    {result.message || "Tente novamente com uma foto mais nítida."}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={retakeCard}
                  className="rounded-xl bg-blue-500 px-5 py-3 text-xs font-black text-white transition hover:bg-blue-400"
                >
                  📸 Tentar novamente
                </button>
              </div>
            </div>
          )}

          {result?.recognized && result.card && !recognizing && (
            <div className="mt-6">
              {/* RESULTADO PRINCIPAL */}

              <div className="overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[#05080f] shadow-2xl shadow-black/40">
                <div className="border-b border-white/[0.08] bg-gradient-to-r from-blue-500/[0.10] via-transparent to-transparent px-5 py-5 sm:px-7">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-[9px] font-black text-emerald-300">
                      ✓ Carta identificada
                    </span>

                    <Badge type={cardType || "Pokémon"} />

                    {result.priceKind === "reference" && (
                      <span className="rounded-full border border-amber-400/20 bg-amber-400/[0.06] px-3 py-1.5 text-[9px] font-black text-amber-300">
                        Impressão de referência
                      </span>
                    )}
                  </div>

                  <h2 className="mt-3 break-words text-2xl font-black tracking-tight sm:text-3xl">
                    {result.card.name}
                  </h2>

                  <p className="mt-1 break-words text-sm text-slate-500">
                    {result.card.set?.name || "Coleção não informada"}
                  </p>
                </div>

                <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[220px_1fr]">
                  <div className="flex min-h-[280px] items-center justify-center rounded-3xl border border-white/[0.07] bg-black/30 p-4">
                    <CardImage
                      large={result.card.images?.large}
                      small={result.card.images?.small}
                      alt={result.card.name}
                    />
                  </div>

                  <div className="min-w-0">
                    {result.priceKind === "reference" && (
                      <div className="mb-4 rounded-2xl border border-amber-400/20 bg-amber-400/[0.05] p-4">
                        <p className="text-sm font-black text-amber-300">
                          ⚠️ Valor de referência
                        </p>

                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          O Pokémon foi identificado, mas a coleção/impressão exata
                          ainda não foi confirmada.
                        </p>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <Info label="Carta" value={result.card.name} />
                      <Info label="Número" value={result.card.number} />
                      <Info
                        label="Coleção"
                        value={result.card.set?.name || "Não informada"}
                      />
                      <Info
                        label="Raridade"
                        value={result.card.rarity || "Não informada"}
                      />
                    </div>

                    {result.pokemon && cardType === "Pokémon" && (
                      <div className="mt-4 rounded-2xl border border-blue-400/10 bg-blue-500/[0.035] p-4">
                        <p className="text-[9px] font-black uppercase tracking-[0.22em] text-blue-400">
                          Pokédex
                        </p>

                        <p className="mt-2 text-lg font-black text-white">
                          {result.pokemon.name}
                        </p>

                        <p className="mt-1 text-xs font-bold text-slate-500">
                          Nº{" "}
                          {String(result.pokemon.nationalDexNumber).padStart(
                            4,
                            "0"
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* VALORES */}

              <div className="mt-5">
                <div className="mb-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                    Etapa 3
                  </p>

                  <h3 className="mt-1 text-2xl font-black">
                    {result.priceKind === "reference"
                      ? "Valor de referência"
                      : "Valor atual"}
                  </h3>

                  {result.priceKind === "reference" && (
                    <p className="mt-1 text-xs text-slate-600">
                      Este valor serve apenas como referência enquanto a impressão
                      exata não for confirmada.
                    </p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <PriceCard
                    label="USD"
                    value={formatPrice(result.prices?.usd, "USD")}
                  />
                  <PriceCard
                    label="BRL"
                    value={formatPrice(result.prices?.brl, "BRL")}
                  />
                  <PriceCard
                    label="EUR"
                    value={formatPrice(result.prices?.eur, "EUR")}
                  />
                </div>
              </div>

              {/* POKÉDEX / COLEÇÃO */}

              {cardType === "Pokémon" && result.pokemon ? (
                <div className="mt-5 overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[#05080f] shadow-2xl shadow-black/30">
                  <div className="border-b border-white/[0.08] bg-gradient-to-r from-blue-500/[0.08] via-transparent to-transparent p-4 sm:p-6">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                      Etapa 4
                    </p>

                    <h3 className="mt-1 text-2xl font-black">
                      Registrar na Pokédex
                    </h3>

                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
                      {registered
                        ? `${result.pokemon.name} já faz parte da sua Pokédex.`
                        : escaped
                        ? `Você escolheu não registrar ${result.pokemon.name} agora.`
                        : `Encontramos ${result.pokemon.name}. Escolha se deseja registrar esta espécie na sua Pokédex.`}
                    </p>
                  </div>

                  <div className="p-4 sm:p-6">
                    {!registered && !escaped ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={registerPokemon}
                          disabled={registering}
                          className="rounded-2xl bg-blue-500 px-6 py-3.5 text-sm font-black text-white shadow-lg shadow-blue-500/15 transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {registering
                            ? "⏳ Registrando..."
                            : "✓ Sim, registrar"}
                        </button>

                        <button
                          type="button"
                          onClick={escapePokemon}
                          className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-3.5 text-sm font-black text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          ✕ Não registrar
                        </button>
                      </div>
                    ) : registered ? (
                      <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] p-5">
                        <p className="font-black text-emerald-300">
                          📖 Pokémon registrado
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {result.pokemon.name} agora faz parte da sua Pokédex.
                        </p>

                        <button
                          type="button"
                          onClick={() => router.push("/pokedex")}
                          className="mt-4 rounded-xl bg-blue-500 px-5 py-3 text-xs font-black text-white transition hover:bg-blue-400"
                        >
                          Abrir minha Pokédex
                        </button>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
                        <p className="font-black text-slate-200">
                          🏃 Pokémon não registrado
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          Você pode escanear outra carta quando quiser.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[2rem] border border-blue-400/10 bg-[#05080f] shadow-2xl shadow-black/30">
                  <div className="bg-gradient-to-r from-blue-500/[0.08] via-transparent to-transparent p-4 sm:p-6">
                    <p className="text-[9px] font-black uppercase tracking-[0.25em] text-blue-400">
                      Coleção
                    </p>

                    <h3 className="mt-1 text-2xl font-black">
                      {cardType === "Trainer"
                        ? "Carta de Treinador"
                        : "Carta de Energia"}
                    </h3>

                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      Esta carta não representa uma espécie Pokémon da Pokédex,
                      mas pode continuar sendo usada normalmente no fluxo da coleção.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-6 grid gap-3 pb-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => router.push("/pokedex")}
              className="rounded-2xl border border-blue-400/10 bg-[#05080f] p-5 text-left transition hover:border-blue-400/25 hover:bg-blue-500/[0.03]"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-500/[0.08] text-xl text-blue-300">
                📖
              </div>

              <h3 className="mt-3 text-sm font-black text-white">
                Minha Pokédex
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-600">
                Veja seus Pokémon registrados e acompanhe suas cartas.
              </p>
            </button>

            <div className="rounded-2xl border border-white/[0.07] bg-[#05080f] p-5 text-left">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.03] text-xl">
                💰
              </div>

              <h3 className="mt-3 text-sm font-black text-white">
                Valores
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-600">
                Compare USD, BRL e EUR sempre que a impressão tiver preço disponível.
              </p>
            </div>
          </div>
        </section>

        <footer className="mt-6 border-t border-white/[0.08] px-2 py-6 text-center text-[10px] font-bold text-slate-700 sm:text-xs">
          PokéScan • Scanner inteligente para sua coleção Pokémon
        </footer>
      </div>
    </main>
  );
}

function CardImage({
  large,
  small,
  alt,
}: {
  large?: string;
  small?: string;
  alt: string;
}) {
  const urls = [large, small].filter(Boolean) as string[];
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [large, small]);

  if (!urls.length || !urls[index]) {
    return (
      <div className="flex h-[250px] w-[170px] flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 text-center">
        <div className="text-5xl">🃏</div>
        <p className="mt-3 px-3 text-xs text-slate-500">Imagem da carta indisponível</p>
      </div>
    );
  }

  const proxied = `/api/card?imageUrl=${encodeURIComponent(urls[index])}`;

  return (
    <img
      src={proxied}
      alt={alt}
      className="max-h-[280px] max-w-full rounded-xl object-contain shadow-2xl"
      onError={() => {
        if (index < urls.length - 1) setIndex((value) => value + 1);
        else setIndex(urls.length);
      }}
    />
  );
}

function Badge({ type }: { type: CardType }) {
  const label = type === "Pokémon" ? "🐾 Pokémon" : type === "Trainer" ? "🧑‍🏫 Treinador" : "⚡ Energia";
  return (
    <span className="rounded-full border border-blue-400/15 bg-blue-500/[0.06] px-3 py-1 text-xs font-bold text-blue-300">
      {label}
    </span>
  );
}

function Step({
  number,
  label,
  active = false,
  done = false,
}: {
  number: string;
  label: string;
  active?: boolean;
  done?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-bold ${
          done
            ? "border-emerald-400 bg-emerald-500 text-white"
            : active
            ? "border-blue-400 bg-blue-500 text-white"
            : "border-white/10 bg-white/5 text-slate-500"
        }`}
      >
        {done ? "✓" : number}
      </div>
      <span
        className={`hidden text-xs sm:block ${
          active || done ? "font-bold text-white" : "text-slate-500"
        }`}
      >
        {label}
      </span>
    </div>
  );
}

function StepLine() {
  return <div className="h-px w-8 bg-white/10 sm:w-12" />;
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[10px] uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-white">{value}</p>
    </div>
  );
}

function PriceCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-blue-400/10 bg-blue-500/[0.035] p-5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-black text-blue-300">{value}</p>
    </div>
  );
}
