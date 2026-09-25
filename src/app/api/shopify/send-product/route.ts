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

    // Protección anti-duplicados en dos niveles:
    // 1. SKU real de la variante.
    // 2. custom.source_sku guardado desde el momento de crear el producto.
    //
    // Esto evita duplicados incluso si Shopify crea el producto pero falla
    // posteriormente la actualización del SKU de la variante.
    const duplicateQuery = `
      query FindExistingProduct($variantQuery: String!, $productQuery: String!) {
        productVariants(first: 10, query: $variantQuery) {
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

        products(first: 10, query: $productQuery) {
          nodes {
            id
            title
            handle
            status
            metafield(namespace: "custom", key: "source_sku") {
              value
            }
            variants(first: 1) {
              nodes {
                id
                sku
              }
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
            variantQuery: `sku:${product.sku}`,
            productQuery: `metafields.custom.source_sku:${product.sku}`,
          },
        }),
      }
    );

    const duplicateResult = await duplicateResponse.json();

    if (!duplicateResponse.ok || duplicateResult.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "No pudimos verificar si el producto ya existe en Shopify.",
          details: duplicateResult.errors || duplicateResult,
        },
        { status: 502 }
      );
    }

    const normalizedSku = product.sku.trim().toUpperCase();

    const existingVariant =
      duplicateResult.data?.productVariants?.nodes?.find(
        (variant: { sku?: string | null }) =>
          String(variant?.sku || "").trim().toUpperCase() === normalizedSku
      );

    const existingSourceProduct =
      duplicateResult.data?.products?.nodes?.find(
        (shopifyProduct: {
          metafield?: { value?: string | null } | null;
        }) =>
          String(shopifyProduct?.metafield?.value || "")
            .trim()
            .toUpperCase() === normalizedSku
      );

    if (existingVariant || existingSourceProduct) {
      const existingProduct =
        existingVariant?.product || existingSourceProduct;

      const existingVariantId =
        existingVariant?.id ||
        existingSourceProduct?.variants?.nodes?.[0]?.id;

      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          duplicateDetectedBy: existingVariant
            ? "variant_sku"
            : "source_sku",
          error: `${product.sku} ya existe en Shopify. No se creó un duplicado.`,
          shopify: {
            productId: existingProduct?.id,
            variantId: existingVariantId,
            title: existingProduct?.title,
            handle: existingProduct?.handle,
            status: existingProduct?.status,
          },
        },
        { status: 409 }
      );
    }

    const commercialContent =
      await generateCommercialProductContent(product);

    const title = commercialContent.title;

    // La descripción de Shopify contiene únicamente contenido comercial.
    // Las especificaciones técnicas se enviarán como metafields.
    const descriptionHtml = commercialContent.descriptionHtml;

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

    // Metacampos técnicos.
    // La fuente de verdad es Technomarine/Supabase, no Gemini.
    const metafieldSources = [
      // Identificador permanente para evitar duplicados incluso si falla
      // posteriormente la asignación del SKU a la variante.
      ["source_sku", product.sku],
      ["collection", product.collection],
      ["gender", product.gender],
      ["case_size", product.case_size],
      ["case_material", product.case_material],
      ["bezel_material", product.bezel_material],
      ["bezel_color", product.bezel_color],
      ["crown_type", product.crown_type],
      ["crystal_type", product.crystal_type],
      ["dial_material", product.dial_material],
      ["caliber", product.caliber],
      ["movement", product.movement],
      ["water_resistance", product.water_resistance],
      ["band_material", product.band_material],
      ["band_tone", product.band_tone],
      ["band_length", product.band_length],
      ["band_size", product.band_size],
    ] as const;

    // Evita enviar valores técnicos vacíos o evidentemente mal formados.
    // Nunca corregimos ni inventamos una especificación: si hay duda, se omite.
    const isValidTechnicalMetafield = (
      key: string,
      value: unknown
    ): boolean => {
      if (
        value === null ||
        value === undefined ||
        String(value).trim().length === 0
      ) {
        return false;
      }

      const normalizedValue = String(value).trim();

      if (key === "water_resistance") {
        // Ejemplo detectado en origen: "5ATMm".
        // Aceptamos únicamente formatos reconocibles como ATM, m/metros o bar.
        return /^(\d+(?:\.\d+)?)\s*(ATM|M|METERS?|METROS?|BAR)$/i.test(
          normalizedValue
        );
      }

      return true;
    };

    const metafields = metafieldSources
      .filter(([key, value]) =>
        isValidTechnicalMetafield(key, value)
      )
      .map(([key, value]) => ({
        namespace: "custom",
        key,
        type: "single_line_text_field",
        value: String(value).trim(),
      }));

    const productInput = {
      title,
      descriptionHtml,

      // Campos comerciales preparados y validados por Gemini.
      vendor: commercialContent.vendor,
      productType: commercialContent.productType,
      status: "DRAFT",

      tags: commercialContent.tags,

      seo: {
        title: commercialContent.seo.title,
        description: commercialContent.seo.description,
      },

      // Especificaciones técnicas provenientes de Technomarine/Supabase.
      metafields,
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
