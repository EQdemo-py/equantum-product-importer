import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateCommercialProductContent } from "@/lib/ai/commercial-product";

export const runtime = "nodejs";

const SHOPIFY_API_VERSION = "2026-07";

export async function POST(request: NextRequest) {
  try {
    const shop = process.env.SHOPIFY_SHOP?.toLowerCase();

    if (!shop) {
      return NextResponse.json(
        { ok: false, error: "Falta SHOPIFY_SHOP." },
        { status: 500 }
      );
    }

    const supabase = createServerSupabaseClient();

    const { data: connection, error: connectionError } = await supabase
      .from("shopify_connections")
      .select("access_token")
      .eq("shop", shop)
      .single();

    if (connectionError || !connection?.access_token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Shopify no está conectado. Conectá UltraMaison nuevamente.",
        },
        { status: 401 }
      );
    }

    const accessToken = connection.access_token;

    const body = await request.json();
    const sku = String(body?.sku || "").trim().toUpperCase();

    if (!sku) {
      return NextResponse.json(
        { ok: false, error: "Falta el SKU del producto." },
        { status: 400 }
      );
    }

    const { data: product, error } = await supabase
      .from("products")
      .select(`
        id,
        sku,
        description,
        collection,
        series,
        gender,
        case_size,
        case_material,
        bezel_material,
        bezel_color,
        crown_type,
        crystal_type,
        dial_material,
        caliber,
        movement,
        water_resistance,
        band_material,
        band_tone,
        band_length,
        band_size,
        main_image,
        raw_data
      `)
      .eq("sku", sku)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !product) {
      return NextResponse.json(
        {
          ok: false,
          error: error?.message || `No encontramos ${sku} en Supabase.`,
        },
        { status: 404 }
      );
    }

    // Protección anti-duplicados:
    // antes de generar contenido o crear el producto, verificamos
    // si Shopify ya tiene una variante con este SKU.
    const duplicateQuery = `
      query FindProductBySku($query: String!) {
        productVariants(first: 10, query: $query) {
          nodes {
            id
            sku
            product {
              id
              title
              handle
              status
            }
          }
        }
      }
    `;

    const duplicateResponse = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: duplicateQuery,
          variables: {
            query: `sku:${product.sku}`,
          },
        }),
      }
    );

    const duplicateResult = await duplicateResponse.json();

    if (!duplicateResponse.ok || duplicateResult.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No pudimos verificar si el SKU ya existe en Shopify.",
          details: duplicateResult.errors || duplicateResult,
        },
        { status: 502 }
      );
    }

    const existingVariant =
      duplicateResult.data?.productVariants?.nodes?.find(
        (variant: { sku?: string | null }) =>
          String(variant?.sku || "").trim().toUpperCase() ===
          product.sku.trim().toUpperCase()
      );

    if (existingVariant) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          error: `${product.sku} ya existe en Shopify. No se creó un duplicado.`,
          shopify: {
            productId: existingVariant.product?.id,
            variantId: existingVariant.id,
            title: existingVariant.product?.title,
            handle: existingVariant.product?.handle,
            status: existingVariant.product?.status,
          },
        },
        { status: 409 }
      );
    }

    const commercialContent =
      await generateCommercialProductContent(product);

    const title = commercialContent.title;

    const specs = [
      ["SKU", product.sku],
      ["Colección", product.collection],
      ["Género", product.gender],
      ["Tamaño de caja", product.case_size],
      ["Material de caja", product.case_material],
      ["Material del bisel", product.bezel_material],
      ["Color del bisel", product.bezel_color],
      ["Corona", product.crown_type],
      ["Cristal", product.crystal_type],
      ["Material del dial", product.dial_material],
      ["Calibre", product.caliber],
      ["Movimiento", product.movement],
      [
        "Resistencia al agua",
        product.water_resistance &&
        /^(\d+(?:\.\d+)?)\s*(ATM|BAR|M|METERS?|METROS?)$/i.test(
          String(product.water_resistance).trim()
        )
          ? product.water_resistance
          : null,
      ],
      ["Material de correa", product.band_material],
      ["Color de correa", product.band_tone],
      ["Largo de correa", product.band_length],
      ["Ancho de correa", product.band_size],
    ].filter(([, value]) => value);

    const specificationsHtml = specs
      .map(
        ([label, value]) =>
          `<li><strong>${label}:</strong> ${value}</li>`
      )
      .join("");

    const descriptionHtml = `
      ${commercialContent.descriptionHtml}
      <h3>Detalles técnicos</h3>
      <ul>${specificationsHtml}</ul>
    `;

    const rawImages = Array.isArray(product.raw_data?.images)
      ? product.raw_data.images
      : [];

    const imageUrls = [
      product.main_image,
      ...rawImages.map((image: { url?: string }) => image?.url),
    ]
      .filter(
        (url): url is string =>
          typeof url === "string" && url.trim().length > 0
      )
      .filter((url, index, array) => array.indexOf(url) === index);

    const productInput = {
      title,
      descriptionHtml,
      vendor: "Technomarine",
      productType: "Reloj",
      status: "DRAFT",
      tags: [
        "Technomarine",
        product.collection,
        product.series,
        product.gender,
        product.sku,
      ].filter(Boolean),
    };

    const createMutation = `
      mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
        productCreate(product: $product, media: $media) {
          product {
            id
            title
            handle
            status
            variants(first: 1) {
              nodes {
                id
                sku
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const createResponse = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: createMutation,
          variables: {
            product: productInput,
            media: imageUrls.map((url) => ({
              originalSource: url,
              mediaContentType: "IMAGE",
              alt: `${title} - ${product.sku}`,
            })),
          },
        }),
      }
    );

    const createResult = await createResponse.json();

    if (createResult.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Error GraphQL creando el producto.",
          details: createResult.errors,
        },
        { status: 400 }
      );
    }

    const createErrors =
      createResult.data?.productCreate?.userErrors || [];

    if (createErrors.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Shopify no pudo crear el producto.",
          details: createErrors,
        },
        { status: 400 }
      );
    }

    const shopifyProduct =
      createResult.data?.productCreate?.product;

    const shopifyProductId = shopifyProduct?.id;
    const variantId =
      shopifyProduct?.variants?.nodes?.[0]?.id;

    if (!shopifyProductId || !variantId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Shopify creó una respuesta incompleta.",
          details: createResult,
        },
        { status: 400 }
      );
    }

    const variantMutation = `
      mutation UpdateVariant(
        $productId: ID!,
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productVariantsBulkUpdate(
          productId: $productId,
          variants: $variants
        ) {
          productVariants {
            id
            sku
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const variantResponse = await fetch(
      `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: variantMutation,
          variables: {
            productId: shopifyProductId,
            variants: [
              {
                id: variantId,
                inventoryItem: {
                  sku: product.sku,
                },
              },
            ],
          },
        }),
      }
    );

    const variantResult = await variantResponse.json();

    if (variantResult.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Producto creado, pero hubo un error configurando el SKU.",
          product: shopifyProduct,
          details: variantResult.errors,
        },
        { status: 400 }
      );
    }

    const variantErrors =
      variantResult.data?.productVariantsBulkUpdate?.userErrors || [];

    if (variantErrors.length) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Producto creado, pero Shopify rechazó la actualización del SKU.",
          product: shopifyProduct,
          details: variantErrors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `${product.sku} enviado a Shopify como borrador.`,
      source: {
        id: product.id,
        sku: product.sku,
      },
      shopify: {
        productId: shopifyProductId,
        variantId,
        title: shopifyProduct.title,
        handle: shopifyProduct.handle,
        status: shopifyProduct.status,
      },
      images: imageUrls.length,
      price: "NO ENVIADO",
      ai: {
        generated: true,
        title: commercialContent.title,
        shortDescription: commercialContent.shortDescription,
        validation: commercialContent.validation,
      },
    });
  } catch (error) {
    console.error("Error enviando producto a Shopify:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error enviando producto a Shopify.",
      },
      { status: 500 }
    );
  }
}
