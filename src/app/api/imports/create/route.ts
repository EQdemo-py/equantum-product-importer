import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ProductImage = {
  url: string;
  type?: string | null;
  imageType?: string | null;
  alt?: string | null;
};

type ImportProduct = {
  sku: string;
  sourceUrl?: string | null;
  url?: string | null;
  familyCode?: string | null;
  name?: string | null;
  collection?: string | null;
  series?: string | null;
  gender?: string | null;
  description?: string | null;
  price?: number | null;
  compareAtPrice?: number | null;
  currency?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  seoHandle?: string | null;
  handle?: string | null;
  technical?: Record<string, unknown> | null;
  features?: Record<string, unknown> | null;
  specifications?: Record<string, unknown> | null;
  images?: ProductImage[];
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const products: ImportProduct[] = Array.isArray(body.products)
      ? body.products
      : [];

    if (products.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No se recibieron productos para guardar.",
        },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

    // 1. Crear la importación
    const { data: importRow, error: importError } = await supabase
      .from("imports")
      .insert({
        name:
          typeof body.name === "string" && body.name.trim()
            ? body.name.trim()
            : `Importación Technomarine ${new Date().toISOString()}`,
        source: "technomarine",
        status: "processing",
        total_products: products.length,
        processed_products: 0,
        successful_products: 0,
        error_products: 0,
      })
      .select("id")
      .single();

    if (importError || !importRow) {
      throw new Error(
        importError?.message || "No se pudo crear la importación."
      );
    }

    let successfulProducts = 0;
    let errorProducts = 0;

    const errors: Array<{ sku: string; error: string }> = [];

    // 2. Guardar cada producto
    for (const product of products) {
      try {
        if (!product.sku) {
          throw new Error("Producto sin SKU.");
        }

        const technical = product.technical ?? {};

        const getTechnical = (key: string) => {
          const value = technical[key];

          if (typeof value === "string") {
            return value;
          }

          return null;
        };

        const images = Array.isArray(product.images)
          ? product.images.filter(
              (image) =>
                image &&
                typeof image.url === "string" &&
                image.url.trim().length > 0
            )
          : [];

        const mainImage = images[0]?.url ?? null;

        const { data: productRow, error: productError } = await supabase
          .from("products")
          .insert({
            import_id: importRow.id,
            sku: product.sku,
            source_url: product.sourceUrl ?? product.url ?? null,
            family_code: product.familyCode ?? null,
            name: product.name ?? null,
            collection: product.collection ?? null,
            series: product.series ?? null,
            gender: product.gender ?? null,
            description: product.description ?? null,
            price: product.price ?? null,
            compare_at_price: product.compareAtPrice ?? null,
            currency: product.currency ?? "USD",

            seo_title: product.seoTitle ?? null,
            seo_description: product.seoDescription ?? null,
            handle: product.seoHandle ?? product.handle ?? null,

            case_size: getTechnical("caseSize"),
            case_material: getTechnical("caseMaterial"),
            bezel_material: getTechnical("bezelMaterial"),
            bezel_color: getTechnical("bezelColor"),
            crown_type: getTechnical("crownType"),
            crystal_type: getTechnical("crystalType"),
            dial_material: getTechnical("dialMaterial"),
            caliber: getTechnical("caliber"),
            movement: getTechnical("movement"),
            water_resistance: getTechnical("waterResistance"),
            band_material: getTechnical("bandMaterial"),
            band_tone: getTechnical("bandTone"),
            band_length: getTechnical("bandLength"),
            band_size: getTechnical("bandSize"),

            main_image: mainImage,

            features: product.features ?? {},
            specifications: product.specifications ?? {},
            raw_data: product,

            status: "completed",
            error_message: null,
          })
          .select("id")
          .single();

        if (productError || !productRow) {
          throw new Error(
            productError?.message || "No se pudo guardar el producto."
          );
        }

        // 3. Guardar las imágenes
        if (images.length > 0) {
          const imageRows = images.map((image, index) => ({
            product_id: productRow.id,
            url: image.url,
            image_type: image.imageType ?? image.type ?? null,
            position: index + 1,
            alt_text:
              image.alt ??
              `${product.name ?? "Technomarine"} ${product.sku}`,
          }));

          const { error: imageError } = await supabase
            .from("product_images")
            .insert(imageRows);

          if (imageError) {
            throw new Error(
              `Producto guardado, pero fallaron sus imágenes: ${imageError.message}`
            );
          }
        }

        successfulProducts++;
      } catch (error) {
        errorProducts++;

        errors.push({
          sku: product.sku || "SIN-SKU",
          error:
            error instanceof Error
              ? error.message
              : "Error desconocido al guardar.",
        });
      }
    }

    // 4. Actualizar el resultado final de la importación
    const finalStatus =
      successfulProducts === products.length
        ? "completed"
        : successfulProducts > 0
          ? "completed_with_errors"
          : "error";

    const { error: updateError } = await supabase
      .from("imports")
      .update({
        status: finalStatus,
        processed_products: products.length,
        successful_products: successfulProducts,
        error_products: errorProducts,
      })
      .eq("id", importRow.id);

    if (updateError) {
      throw new Error(
        `Los productos se procesaron, pero no se pudo actualizar la importación: ${updateError.message}`
      );
    }

    return NextResponse.json({
      ok: errorProducts === 0,
      importId: importRow.id,
      total: products.length,
      successful: successfulProducts,
      errors: errorProducts,
      details: errors,
    });
  } catch (error) {
    console.error("Error creando importación:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error interno al guardar la importación.",
      },
      { status: 500 }
    );
  }
}
