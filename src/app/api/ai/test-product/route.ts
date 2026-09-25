import { NextRequest, NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { generateCommercialProductContent } from "@/lib/ai/commercial-product";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const sku = String(body?.sku || "").trim().toUpperCase();

    if (!sku) {
      return NextResponse.json(
        { ok: false, error: "Falta el SKU." },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();

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
        band_size
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

    const commercialContent =
      await generateCommercialProductContent(product);

    return NextResponse.json({
      ok: true,
      sku: product.sku,
      source: product,
      commercialContent,
    });
  } catch (error) {
    console.error("Gemini test error:", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error desconocido probando Gemini.",
      },
      { status: 500 }
    );
  }
}
