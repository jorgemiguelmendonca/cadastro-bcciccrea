import { NextRequest, NextResponse } from "next/server";

import { createClient } from "@supabase/supabase-js";

import { z } from "zod";

import {
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

/**
 * --------------------------------------------------------------------------
 * Schema
 * --------------------------------------------------------------------------
 *
 * O telefone agora é internacional.
 *
 * O frontend envia:
 *
 * country:
 * "PT"
 *
 * phone:
 * "912 345 678"
 *
 * phone_international:
 * "+351912345678"
 *
 * A validação definitiva é feita novamente no servidor.
 */

const schema = z.object({
  name: z.string().trim().min(2).max(100),

  phone: z.string().trim().min(3).max(40),

  country: z
    .string()
    .trim()
    .length(2)
    .transform(value => value.toUpperCase()),

  phone_international: z.string().trim().min(5).max(30).optional(),

  email: z.string().trim().email().max(150),

  consent: z.literal(true),

  source: z
    .string()
    .trim()
    .max(100)
    .optional()
    .default("landing-consultoria-credito"),

  utm_source: z.string().trim().max(100).optional(),

  utm_medium: z.string().trim().max(100).optional(),

  utm_campaign: z.string().trim().max(150).optional(),

  utm_term: z.string().trim().max(150).optional(),

  gclid: z.string().trim().max(300).optional(),
});

/**
 * --------------------------------------------------------------------------
 * POST
 * --------------------------------------------------------------------------
 */

export async function POST(request: NextRequest) {
  try {
    /**
     * ----------------------------------------------------------------------
     * 1. Ler JSON
     * ----------------------------------------------------------------------
     */

    const body = await request.json();

    /**
     * ----------------------------------------------------------------------
     * 2. Validar estrutura dos dados
     * ----------------------------------------------------------------------
     */

    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message || "Dados inválidos.",
        },
        {
          status: 400,
        }
      );
    }

    const data = parsed.data;

    /**
     * ----------------------------------------------------------------------
     * 3. Validar país
     * ----------------------------------------------------------------------
     *
     * libphonenumber-js utiliza códigos ISO de duas letras:
     *
     * PT = Portugal
     * BR = Brasil
     * IT = Itália
     * ES = Espanha
     * FR = França
     * etc.
     */

    const countryCode = data.country as CountryCode;

    /**
     * ----------------------------------------------------------------------
     * 4. Validar e normalizar telefone
     * ----------------------------------------------------------------------
     *
     * O número é interpretado de acordo com o país selecionado.
     *
     * Não usamos mais regex específica de Portugal.
     */

    const phoneNumber = parsePhoneNumberFromString(data.phone, countryCode);

    if (!phoneNumber || !phoneNumber.isValid()) {
      return NextResponse.json(
        {
          ok: false,
          error: "Insira um número de telefone válido para o país selecionado.",
        },
        {
          status: 400,
        }
      );
    }

    /**
     * ----------------------------------------------------------------------
     * 5. Número internacional E.164
     * ----------------------------------------------------------------------
     *
     * Exemplos:
     *
     * Portugal:
     * +351912345678
     *
     * Brasil:
     * +5511999999999
     *
     * Itália:
     * +393201234567
     */

    const normalizedPhone = phoneNumber.number;

    /**
     * ----------------------------------------------------------------------
     * 6. Variáveis de ambiente
     * ----------------------------------------------------------------------
     */

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const whatsappNumber = process.env.WHATSAPP_NUMBER;

    if (!supabaseUrl || !serviceRoleKey || !whatsappNumber) {
      console.error("Variáveis de ambiente ausentes.");

      return NextResponse.json(
        {
          ok: false,
          error: "Serviço temporariamente indisponível.",
        },
        {
          status: 500,
        }
      );
    }

    /**
     * ----------------------------------------------------------------------
     * 7. Supabase
     * ----------------------------------------------------------------------
     */

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      db: {
        schema: "public",
      },

      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    /**
     * ----------------------------------------------------------------------
     * 8. Salvar lead
     * ----------------------------------------------------------------------
     *
     * Importante:
     *
     * A coluna "phone" continuará sendo utilizada.
     *
     * Porém agora ela recebe o número internacional normalizado.
     *
     * Exemplo:
     *
     * +351912345678
     * +5511999999999
     * +393201234567
     */

    const { data: insertedLead, error: insertError } = await supabase
      .from("leads")
      .insert({
        name: data.name,

        phone: normalizedPhone,

        email: data.email,

        consent: data.consent,

        source: data.source,

        utm_source: data.utm_source ?? null,

        utm_medium: data.utm_medium ?? null,

        utm_campaign: data.utm_campaign ?? null,

        utm_term: data.utm_term ?? null,

        gclid: data.gclid ?? null,
      })
      .select("id")
      .single();

    /**
     * ----------------------------------------------------------------------
     * 9. Erro Supabase
     * ----------------------------------------------------------------------
     */

    if (insertError) {
      console.error("Supabase insert error:", insertError);

      return NextResponse.json(
        {
          ok: false,
          error: "Não foi possível registrar o pedido.",
        },
        {
          status: 500,
        }
      );
    }

    /**
     * ----------------------------------------------------------------------
     * 10. Mensagem WhatsApp
     * ----------------------------------------------------------------------
     *
     * Usamos o número internacional normalizado para evitar ambiguidades.
     */

    const message = [
      `Olá, sou ${data.name}.`,

      "",

      "Acabei de preencher o formulário de contacto para obter informações sobre soluções de crédito.",

      "",

      `Telefone: ${normalizedPhone}`,

      `Email: ${data.email}`,

      "",

      "Gostaria de falar com um consultor.",
    ].join("\n");

    /**
     * ----------------------------------------------------------------------
     * 11. Número do WhatsApp
     * ----------------------------------------------------------------------
     *
     * O WHATSAPP_NUMBER deve ser configurado no .env.local sem:
     *
     * +
     * espaços
     * parênteses
     * hífens
     *
     * Exemplo:
     *
     * WHATSAPP_NUMBER=351912345678
     */

    const normalizedWhatsappNumber = whatsappNumber.replace(/\D/g, "");

    if (normalizedWhatsappNumber.length < 7) {
      console.error("Número de WhatsApp inválido.");

      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp configurado incorretamente.",
        },
        {
          status: 500,
        }
      );
    }

    /**
     * ----------------------------------------------------------------------
     * 12. URL WhatsApp
     * ----------------------------------------------------------------------
     */

    const whatsappUrl =
      `https://wa.me/${normalizedWhatsappNumber}` +
      `?text=${encodeURIComponent(message)}`;

    /**
     * ----------------------------------------------------------------------
     * 13. Sucesso
     * ----------------------------------------------------------------------
     */

    return NextResponse.json({
      ok: true,

      leadId: insertedLead?.id ?? null,

      whatsappUrl,
    });
  } catch (error) {
    console.error("API /api/leads error:", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Pedido inválido.",
      },
      {
        status: 400,
      }
    );
  }
}
