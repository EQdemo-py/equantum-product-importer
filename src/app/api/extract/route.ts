import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const ALLOWED_HOSTS = new Set([
  "technomarine.com",
  "www.technomarine.com",
]);

type TechnomarineImage = {
  id?: number;
  type?: string;
  name?: string;
  base_url?: string;
};

type TechnomarineWatch = {
  id?: number;
  model_no?: string;
  product_family_code?: string;
  name?: string;
  description?: string;
  price?: number;
  seo_title?: string;
  seo_description?: string;
  seo_url?: string;
  collection_name?: string;
  serie_name?: string;
  band_tone?: string;
  case_size?: string;
  gender?: string | null;
  url?: string;
  main_image?: {
    desktop?: string;
    mobile?: string;
  };
  images?: TechnomarineImage[];
};

function clean(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function decodeHtml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function buildImageUrl(baseUrl?: string) {
  if (!baseUrl) return null;

  // Technomarine utiliza sufijos de tamaño sobre el base_url.
  return `${baseUrl}_m.jpg`;
}

async function downloadHtml(url: string) {
  const parsed = new URL(url);

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error("Dominio no permitido");
  }

  /*
   * Technomarine/Imperva responde correctamente a curl desde el servidor,
   * mientras que el fetch nativo puede recibir 403.
   */
  const { stdout } = await execFileAsync(
    "curl",
    [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "30",
      "-A",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36",
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H",
      "Accept-Language: es-ES,es;q=0.9,en;q=0.8",
      url,
    ],
    {
      maxBuffer: 5 * 1024 * 1024,
    }
  );

  return stdout;
}

export async function GET(request: NextRequest) {
  try {
    const sku = request.nextUrl.searchParams
      .get("sku")
      ?.trim()
      .toUpperCase();

    if (!sku || !/^TM-\d+$/.test(sku)) {
      return NextResponse.json(
        {
          success: false,
          error: "SKU inválido. Ejemplo: TM-724002",
        },
        { status: 400 }
      );
    }

    const sourceUrl =
      `https://www.technomarine.com/watches/${encodeURIComponent(sku)}`;

    const html = await downloadHtml(sourceUrl);
    const $ = cheerio.load(html);

    // --------------------------------------------------
    // PRODUCTO PRINCIPAL
    // Technomarine entrega un JSON completo en :watch.
    // --------------------------------------------------

    const watchElement = $("watch-details").first();

    if (!watchElement.length) {
      throw new Error("No se encontró el bloque watch-details");
    }

    const rawWatch = watchElement.attr(":watch");

    if (!rawWatch) {
      throw new Error("No se encontró el JSON del producto");
    }

    let watch: TechnomarineWatch;

    try {
      watch = JSON.parse(decodeHtml(rawWatch));
    } catch {
      throw new Error("No se pudo interpretar el JSON del producto");
    }

    if (
      watch.model_no &&
      watch.model_no.toUpperCase() !== sku
    ) {
      throw new Error(
        `El SKU recibido (${watch.model_no}) no coincide con ${sku}`
      );
    }

    // --------------------------------------------------
    // FEATURES
    // --------------------------------------------------

    const features: Record<string, string> = {};

    $(".product-card__features .feature").each((_, element) => {
      const name = clean($(element).find(".feature-name").text());
      const value = clean($(element).find(".feature-value").text());

      if (name && value) {
        features[name] = value
          .replace(/\s*,\s*/g, ", ")
          .trim();
      }
    });

    // --------------------------------------------------
    // SPECS
    // --------------------------------------------------

    const specifications: Record<string, string> = {};

    $(".product-card__specs table tr").each((_, row) => {
      const category = clean($(row).find("th").first().text());

      $(row)
        .find("td.spec-values li span")
        .each((_, item) => {
          const text = clean($(item).text());

          if (!text) return;

          const separator = text.indexOf(":");

          if (separator !== -1) {
            const key = clean(text.slice(0, separator));
            const value = clean(text.slice(separator + 1));

            if (key && value) {
              specifications[key] = value;
            }
          } else if (category) {
            specifications[category] = text;
          }
        });
    });

    // --------------------------------------------------
    // IMÁGENES
    // --------------------------------------------------

    const images = (watch.images || [])
      .map((image, index) => ({
        position: index + 1,
        type: image.type || null,
        url: buildImageUrl(image.base_url),
      }))
      .filter(
        (
          image
        ): image is {
          position: number;
          type: string | null;
          url: string;
        } => Boolean(image.url)
      );

    const mainImage =
      watch.main_image?.desktop ||
      watch.main_image?.mobile ||
      images[0]?.url ||
      null;

    // --------------------------------------------------
    // NORMALIZACIÓN
    // --------------------------------------------------

    const caseSize =
      specifications["Case Size"] ||
      watch.case_size ||
      null;

    const caseMaterial =
      specifications["Case Material"] ||
      null;

    const bezelMaterial =
      specifications["Bezel Material"] ||
      null;

    const bezelColor =
      specifications["Bezel Color"] ||
      null;

    const crownType =
      specifications["Crown Type"] ||
      null;

    const crystalType =
      specifications["Crystal Type"] ||
      null;

    const dialMaterial =
      specifications["Dial Material"] ||
      null;

    const caliber =
      specifications["Caliber"] ||
      features["Movement"] ||
      null;

    const waterResistance =
      specifications["Water Resistance"] ||
      features["Water resistance"] ||
      null;

    const bandMaterial =
      specifications["Material"] ||
      features["Band"] ||
      null;

    const bandTone =
      specifications["Tone"] ||
      watch.band_tone ||
      null;

    const bandLength =
      specifications["Length"] ||
      null;

    const bandSize =
      specifications["Size"] ||
      null;

    return NextResponse.json({
      success: true,

      source: {
        provider: "Technomarine",
        url: sourceUrl,
      },

      product: {
        sku: watch.model_no || sku,
        familyCode: watch.product_family_code || null,

        name: clean(watch.name),
        collection: clean(watch.collection_name),
        series: clean(watch.serie_name),
        gender: clean(watch.gender),

        description: clean(watch.description),

        price: watch.price ?? null,
        currency: "USD",
        compareAtPrice: null,

        seo: {
          title: clean(watch.seo_title),
          description: clean(watch.seo_description),
          handle: clean(watch.seo_url),
        },

        technical: {
          caseSize,
          caseMaterial,
          bezelMaterial,
          bezelColor,
          crownType,
          crystalType,
          dialMaterial,
          caliber,
          movement: features["Movement"] || caliber,
          waterResistance,
          bandMaterial,
          bandTone,
          bandLength,
          bandSize,
        },

        mainImage,
        images,

        features,
        specifications,
      },

      debug: {
        htmlLength: html.length,
        imageCount: images.length,
        featureCount: Object.keys(features).length,
        specificationCount: Object.keys(specifications).length,
      },
    });
  } catch (error) {
    console.error("Technomarine extraction error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido durante la extracción",
      },
      { status: 500 }
    );
  }
}
