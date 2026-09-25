import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SHOPIFY_PRODUCT_ID = "gid://shopify/Product/10302341316849";
const SKU = "TM-525011";

export async function GET(request: NextRequest) {
  try {
    const shop = process.env.SHOPIFY_SHOP;
    const accessToken = request.cookies.get("shopify_access_token")?.value;

    if (!shop || !accessToken) {
      return NextResponse.json(
        { ok: false, error: "Shopify no está conectado." },
        { status: 401 }
      );
    }

    const supabase = createServerSupabaseClient();

    const { data: product, error } = await supabase
      .from("products")
      .select(`
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
        band_size
      `)
      .eq("sku", SKU)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !product) {
      throw new Error(error?.message || `No encontramos ${SKU}.`);
    }

    const title =
      `TECHNOMARINE ${product.collection || product.series || "WATCH"} ${product.gender || ""} ${product.case_size || ""} - ${product.sku}`
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

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
      ["Resistencia al agua", product.water_resistance],
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
      <p>${product.description || ""}</p>
      <h3>Detalles técnicos</h3>
      <ul>${specificationsHtml}</ul>
    `;

    const mutation = `
      mutation UpdateRealProduct(
        $product: ProductUpdateInput!,
        $productId: ID!,
        $variants: [ProductVariantsBulkInput!]!
      ) {
        productUpdate(product: $product) {
          product {
            id
            title
            handle
            status
          }
          userErrors {
            field
            message
          }
        }

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

    // Primero obtener la variante actual del producto.
    const variantQuery = `
      query GetProductVariant($id: ID!) {
        product(id: $id) {
          id
          variants(first: 1) {
            nodes {
              id
              sku
            }
          }
        }
      }
    `;

    const variantResponse = await fetch(
      `https://${shop}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: variantQuery,
          variables: { id: SHOPIFY_PRODUCT_ID },
        }),
      }
    );

    const variantResult = await variantResponse.json();

    const variantId =
      variantResult?.data?.product?.variants?.nodes?.[0]?.id;

    if (!variantId) {
      return NextResponse.json(
        {
          ok: false,
          error: "No encontramos la variante del producto en Shopify.",
          details: variantResult,
        },
        { status: 400 }
      );
    }

    const response = await fetch(
      `https://${shop}/admin/api/2026-07/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({
          query: mutation,
          variables: {
            productId: SHOPIFY_PRODUCT_ID,
            product: {
              id: SHOPIFY_PRODUCT_ID,
              title,
              descriptionHtml,
              vendor: "Technomarine",
              productType: "Reloj",
              status: "DRAFT",
              tags: [
                "Technomarine",
                product.collection,
                product.gender,
                product.sku,
              ].filter(Boolean),
            },
            variants: [
              {
                id: variantId,
                sku: product.sku,
              },
            ],
          },
        }),
      }
    );

    const result = await response.json();

    if (result.errors?.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Error GraphQL.",
          details: result.errors,
        },
        { status: 400 }
      );
    }

    const productErrors =
      result.data?.productUpdate?.userErrors || [];

    const variantErrors =
      result.data?.productVariantsBulkUpdate?.userErrors || [];

    if (productErrors.length || variantErrors.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "Shopify devolvió errores.",
          productErrors,
          variantErrors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Producto actualizado correctamente.",
      product: result.data.productUpdate.product,
      variant:
        result.data.productVariantsBulkUpdate.productVariants?.[0],
      price: "SIN MODIFICAR",
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error actualizando producto.",
      },
      { status: 500 }
    );
  }
}
