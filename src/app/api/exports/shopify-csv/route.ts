import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const HEADERS = [
  "Title",
  "URL handle",
  "Description",
  "Vendor",
  "Product category",
  "Type",
  "Tags",
  "Published on online store",
  "Status",
  "SKU",
  "Barcode",
  "Option1 name",
  "Option1 value",
  "Option1 Linked To",
  "Option2 name",
  "Option2 value",
  "Option2 Linked To",
  "Option3 name",
  "Option3 value",
  "Option3 Linked To",
  "Price",
  "Compare-at price",
  "Cost per item",
  "Charge tax",
  "Tax code",
  "Unit price total measure",
  "Unit price total measure unit",
  "Unit price base measure",
  "Unit price base measure unit",
  "Inventory tracker",
  "Inventory quantity",
  "Continue selling when out of stock",
  "Weight value (grams)",
  "Weight unit for display",
  "Requires shipping",
  "Fulfillment service",
  "Product image URL",
  "Image position",
  "Image alt text",
  "Variant image URL",
  "Gift card",
  "SEO title",
  "SEO description",
  "Color (product.metafields.shopify.color-pattern)",
  "Google Shopping / Google product category",
  "Google Shopping / Gender",
  "Google Shopping / Age group",
  "Google Shopping / Manufacturer part number (MPN)",
  "Google Shopping / Ad group name",
  "Google Shopping / Ads labels",
  "Google Shopping / Condition",
  "Google Shopping / Custom product",
  "Google Shopping / Custom label 0",
  "Google Shopping / Custom label 1",
  "Google Shopping / Custom label 2",
  "Google Shopping / Custom label 3",
  "Google Shopping / Custom label 4",
];

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";

  const text = String(value);

  if (
    text.includes(",") ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function cleanText(value: unknown) {
  if (value === null || value === undefined) return "";

  const text = String(value)
    .replace(/\b(?:none|null|undefined|n\/a)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function upperText(value: unknown) {
  return cleanText(value).toUpperCase();
}

function cleanTags(values: unknown[]) {
  return [...new Set(values.map(cleanText).filter(Boolean))].join(", ");
}

function cleanHandle(value: unknown, sku: unknown) {
  const source = cleanText(value) || cleanText(sku);

  return source
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeGender(gender: string | null) {
  if (!gender) return "";

  const value = gender.toLowerCase();

  if (value.includes("men")) return "Male";
  if (value.includes("women")) return "Female";

  return "Unisex";
}

export async function GET(request: NextRequest) {
  try {
    const importId = request.nextUrl.searchParams.get("importId");

    const supabase = createServerSupabaseClient();

    let selectedImportId = importId;

    if (!selectedImportId) {
      const { data: latestImport, error: latestImportError } = await supabase
        .from("imports")
        .select("id")
        .in("status", ["completed", "completed_with_errors"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestImportError) {
        throw new Error(latestImportError.message);
      }

      if (!latestImport) {
        return NextResponse.json(
          {
            ok: false,
            error: "No hay importaciones disponibles para exportar.",
          },
          { status: 404 }
        );
      }

      selectedImportId = latestImport.id;
    }

    let query = supabase
      .from("products")
      .select(`
        *,
        product_images (
          url,
          position,
          alt_text
        )
      `)
      .eq("status", "completed")
      .order("created_at", { ascending: true });

    query = query.eq("import_id", selectedImportId);

    const { data: products, error } = await query;

    if (error) {
      throw new Error(error.message);
    }

    if (!products || products.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No hay productos disponibles para exportar.",
        },
        { status: 404 }
      );
    }

    const rows: Record<string, unknown>[] = [];

    for (const product of products) {
      const images = Array.isArray(product.product_images)
        ? [...product.product_images].sort(
            (a, b) => (a.position ?? 0) - (b.position ?? 0)
          )
        : [];

      const productName = cleanText(product.name);
      const sku = cleanText(product.sku);
      const collection = cleanText(product.collection);
      const series = cleanText(product.series);
      const gender = cleanText(product.gender);
      const bandTone = cleanText(product.band_tone);

      const titleParts = [productName, series]
        .map(cleanText)
        .filter(Boolean);

      const title = upperText(
        [...new Set(titleParts)].join(" ") || sku
      );

      const tags = cleanTags([
        "Technomarine",
        collection,
        series,
        gender,
      ]);

      const handle = cleanHandle(product.handle, sku);

      const imageAlt = `${title || "RELOJ TECHNOMARINE"} ${sku}`.trim();

      const baseRow: Record<string, unknown> = {
        "Title": title,
        "URL handle": handle,
        "Description": cleanText(product.description),
        "Vendor": "Technomarine",
        "Product category": "Apparel & Accessories > Jewelry > Watches",
        "Type": "Reloj",
        "Tags": tags,
        "Published on online store": "FALSE",
        "Status": "Draft",
        "SKU": sku,
        "Barcode": "",
        "Option1 name": "Title",
        "Option1 value": "Default Title",
        "Option1 Linked To": "",
        "Option2 name": "",
        "Option2 value": "",
        "Option2 Linked To": "",
        "Option3 name": "",
        "Option3 value": "",
        "Option3 Linked To": "",
        "Price": product.price ?? "",
        "Compare-at price": product.compare_at_price ?? "",
        "Cost per item": "",
        "Charge tax": "TRUE",
        "Tax code": "",
        "Unit price total measure": "",
        "Unit price total measure unit": "",
        "Unit price base measure": "",
        "Unit price base measure unit": "",
        "Inventory tracker": "shopify",
        "Inventory quantity": "0",
        "Continue selling when out of stock": "DENY",
        "Weight value (grams)": "",
        "Weight unit for display": "g",
        "Requires shipping": "TRUE",
        "Fulfillment service": "manual",
        "Product image URL":
          cleanText(images[0]?.url) || cleanText(product.main_image),
        "Image position": images.length > 0 ? 1 : "",
        "Image alt text":
          cleanText(images[0]?.alt_text) || imageAlt,
        "Variant image URL": "",
        "Gift card": "FALSE",
        "SEO title": upperText(
          cleanText(product.seo_title) || title
        ),
        "SEO description": cleanText(product.seo_description),
        "Color (product.metafields.shopify.color-pattern)": bandTone,
        "Google Shopping / Google product category":
          "Apparel & Accessories > Jewelry > Watches",
        "Google Shopping / Gender": normalizeGender(gender),
        "Google Shopping / Age group": "Adult (13+ years old)",
        "Google Shopping / Manufacturer part number (MPN)": sku,
        "Google Shopping / Ad group name": "",
        "Google Shopping / Ads labels": "",
        "Google Shopping / Condition": "New",
        "Google Shopping / Custom product": "FALSE",
        "Google Shopping / Custom label 0": collection,
        "Google Shopping / Custom label 1": series,
        "Google Shopping / Custom label 2": "",
        "Google Shopping / Custom label 3": "",
        "Google Shopping / Custom label 4": "",
      };

      rows.push(baseRow);

      for (const image of images.slice(1)) {
        rows.push({
          ...Object.fromEntries(HEADERS.map((header) => [header, ""])),
          "URL handle": handle,
          "Product image URL": cleanText(image.url),
          "Image position": image.position,
          "Image alt text": cleanText(image.alt_text) || imageAlt,
        });
      }
    }

    const csv = [
      HEADERS.map(csvValue).join(","),
      ...rows.map((row) =>
        HEADERS.map((header) => csvValue(row[header])).join(",")
      ),
    ].join("\r\n");

    const filename = `ultramaison-shopify-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    return new NextResponse("\uFEFF" + csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Error exportando Shopify CSV:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error generando el CSV de Shopify.",
      },
      { status: 500 }
    );
  }
}
