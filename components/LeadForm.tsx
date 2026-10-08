"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  validatePhoneNumberLength,
  type CountryCode,
} from "libphonenumber-js";

/**
 * --------------------------------------------------------------------------
 * Configuração
 * --------------------------------------------------------------------------
 */

const DEFAULT_COUNTRY: CountryCode = "PT";

/**
 * --------------------------------------------------------------------------
 * Países
 * --------------------------------------------------------------------------
 */

const countries = getCountries();

function getCountryName(countryCode: CountryCode) {
  try {
    const displayNames = new Intl.DisplayNames(["pt-PT"], {
      type: "region",
    });

    return displayNames.of(countryCode) || countryCode;
  } catch {
    return countryCode;
  }
}

function getCountryFlag(countryCode: CountryCode) {
  return countryCode
    .toUpperCase()
    .split("")
    .map(char => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join("");
}

/**
 * --------------------------------------------------------------------------
 * Tracking
 * --------------------------------------------------------------------------
 */

function getTracking() {
  const params = new URLSearchParams(window.location.search);

  return {
    utm_source: params.get("utm_source") ?? undefined,
    utm_medium: params.get("utm_medium") ?? undefined,
    utm_campaign: params.get("utm_campaign") ?? undefined,
    utm_term: params.get("utm_term") ?? undefined,
    gclid: params.get("gclid") ?? undefined,
  };
}

/**
 * --------------------------------------------------------------------------
 * LeadForm
 * --------------------------------------------------------------------------
 */

export default function LeadForm() {
  const router = useRouter();

  const [name, setName] = useState("");

  const [country, setCountry] = useState<CountryCode>(DEFAULT_COUNTRY);

  const [phone, setPhone] = useState("");

  const [email, setEmail] = useState("");

  const [consent, setConsent] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  /**
   * ------------------------------------------------------------------------
   * Lista de países
   * ------------------------------------------------------------------------
   */

  const countryOptions = useMemo(() => {
    return countries
      .map(countryCode => ({
        code: countryCode,
        name: getCountryName(countryCode),
        callingCode: getCountryCallingCode(countryCode),
        flag: getCountryFlag(countryCode),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-PT"));
  }, []);

  /**
   * ------------------------------------------------------------------------
   * Tracking
   * ------------------------------------------------------------------------
   */

  useEffect(() => {
    const tracking = getTracking();

    sessionStorage.setItem("lead_tracking", JSON.stringify(tracking));
  }, []);

  /**
   * ------------------------------------------------------------------------
   * Alterar país
   * ------------------------------------------------------------------------
   */

  function handleCountryChange(event: React.ChangeEvent<HTMLSelectElement>) {
    const selectedCountry = event.target.value as CountryCode;

    setCountry(selectedCountry);

    // Evita manter um número do país anterior
    setPhone("");

    setError("");
  }

  /**
   * ------------------------------------------------------------------------
   * Telefone
   * ------------------------------------------------------------------------
   *
   * A biblioteca:
   *
   * - formata o número enquanto o utilizador digita;
   * - identifica o tamanho máximo permitido;
   * - impede números excessivamente longos;
   * - funciona para diferentes países.
   */

  function handlePhoneChange(event: React.ChangeEvent<HTMLInputElement>) {
    const value = event.target.value;

    /**
     * --------------------------------------------------------------
     * Verificar se o número já ultrapassou o tamanho permitido
     * --------------------------------------------------------------
     */

    const lengthStatus = validatePhoneNumberLength(value, country);

    /**
     * TOO_LONG significa que já ultrapassou o comprimento
     * máximo possível para aquele país.
     *
     * Nesse caso simplesmente ignoramos o novo caractere.
     */
    if (lengthStatus === "TOO_LONG") {
      return;
    }

    /**
     * --------------------------------------------------------------
     * Formatação automática
     * --------------------------------------------------------------
     */

    const formatter = new AsYouType(country);

    const formatted = formatter.input(value);

    setPhone(formatted);

    /**
     * Limpar erro enquanto o utilizador corrige o número
     */
    if (error) {
      setError("");
    }
  }

  /**
   * ------------------------------------------------------------------------
   * Envio
   * ------------------------------------------------------------------------
   */

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setError("");

    /**
     * ----------------------------------------------------------------------
     * Nome
     * ----------------------------------------------------------------------
     */

    if (name.trim().length < 2) {
      setError("Insira o seu nome completo.");
      return;
    }

    /**
     * ----------------------------------------------------------------------
     * Telefone
     * ----------------------------------------------------------------------
     */

    const phoneNumber = parsePhoneNumberFromString(phone, country);

    /**
     * Número inexistente ou inválido
     */
    if (!phoneNumber || !phoneNumber.isValid()) {
      setError("Insira um número de telefone válido para o país selecionado.");
      return;
    }

    /**
     * ----------------------------------------------------------------------
     * Número internacional E.164
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

    const internationalPhone = phoneNumber.number;

    /**
     * ----------------------------------------------------------------------
     * Email
     * ----------------------------------------------------------------------
     */

    if (!email.trim()) {
      setError("Insira o seu endereço de e-mail.");
      return;
    }

    /**
     * ----------------------------------------------------------------------
     * Consentimento
     * ----------------------------------------------------------------------
     */

    if (!consent) {
      setError(
        "É necessário aceitar os Termos de Uso e a Política de Privacidade para continuar."
      );

      return;
    }

    setLoading(true);

    try {
      /**
       * --------------------------------------------------------------------
       * Tracking
       * --------------------------------------------------------------------
       */

      const tracking = JSON.parse(
        sessionStorage.getItem("lead_tracking") || "{}"
      );

      /**
       * --------------------------------------------------------------------
       * Enviar para API
       * --------------------------------------------------------------------
       */

      const response = await fetch("/api/leads", {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        body: JSON.stringify({
          name: name.trim(),

          // Número formatado visualmente
          phone,

          // Número internacional normalizado
          phone_international: internationalPhone,

          // País selecionado
          country,

          email: email.trim(),

          consent,

          source: "landing-consultoria-credito",

          ...tracking,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "Não foi possível enviar o formulário."
        );
      }

      /**
       * --------------------------------------------------------------------
       * WhatsApp
       * --------------------------------------------------------------------
       */

      if (result.whatsappUrl) {
        sessionStorage.setItem("lead_whatsapp_url", result.whatsappUrl);
      }

      /**
       * --------------------------------------------------------------------
       * ID do lead
       * --------------------------------------------------------------------
       */

      if (result.leadId) {
        sessionStorage.setItem("lead_id", String(result.leadId));
      }

      /**
       * --------------------------------------------------------------------
       * Página de obrigado
       * --------------------------------------------------------------------
       */

      router.push("/obrigado");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Ocorreu um erro. Tente novamente."
      );

      setLoading(false);
    }
  }

  /**
   * ------------------------------------------------------------------------
   * Render
   * ------------------------------------------------------------------------
   */

  return (
    <form className="lead-form" onSubmit={handleSubmit} noValidate>
      {/* ------------------------------------------------------------------ */}
      {/* NOME                                                               */}
      {/* ------------------------------------------------------------------ */}

      <label>
        Nome completo
        <input
          type="text"
          value={name}
          onChange={event => {
            setName(event.target.value);

            if (error) {
              setError("");
            }
          }}
          required
          maxLength={100}
          autoComplete="name"
          placeholder="O seu nome completo"
        />
      </label>

      {/* ------------------------------------------------------------------ */}
      {/* TELEFONE                                                            */}
      {/* ------------------------------------------------------------------ */}

      <label>
        Telefone
        <div className="phone-field">
          {/* PAÍS */}

          <select
            className="phone-country"
            value={country}
            onChange={handleCountryChange}
            aria-label="País"
          >
            {countryOptions.map(item => (
              <option key={item.code} value={item.code}>
                {item.flag} {item.name} +{item.callingCode}
              </option>
            ))}
          </select>

          {/* NÚMERO */}

          <input
            className="phone-number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="Número de telefone"
            maxLength={30}
            required
            aria-label="Número de telefone"
          />
        </div>
      </label>

      {/* ------------------------------------------------------------------ */}
      {/* EMAIL                                                               */}
      {/* ------------------------------------------------------------------ */}

      <label>
        E-mail
        <input
          type="email"
          value={email}
          onChange={event => {
            setEmail(event.target.value);

            if (error) {
              setError("");
            }
          }}
          required
          maxLength={150}
          autoComplete="email"
          placeholder="O seu e-mail"
        />
      </label>

      {/* ------------------------------------------------------------------ */}
      {/* CONSENTIMENTO                                                       */}
      {/* ------------------------------------------------------------------ */}

      <label className="consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={event => {
            setConsent(event.target.checked);

            if (error) {
              setError("");
            }
          }}
        />

        <span>
          Aceito os{" "}
          <a href="/termos-de-uso" target="_blank" rel="noopener noreferrer">
            Termos de Uso
          </a>{" "}
          e a{" "}
          <a
            href="/politica-de-privacidade"
            target="_blank"
            rel="noopener noreferrer"
          >
            Política de Privacidade
          </a>{" "}
          e autorizo o contacto relativamente ao pedido efetuado, incluindo
          através de telefone, e-mail e WhatsApp.
        </span>
      </label>

      {/* ------------------------------------------------------------------ */}
      {/* ERRO                                                                */}
      {/* ------------------------------------------------------------------ */}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* BOTÃO                                                               */}
      {/* ------------------------------------------------------------------ */}

      <button type="submit" disabled={loading}>
        {loading ? "A enviar..." : "Solicitar contacto"}
      </button>

      {/* ------------------------------------------------------------------ */}
      {/* DISCLAIMER                                                          */}
      {/* ------------------------------------------------------------------ */}

      <p className="disclaimer">
        O envio deste formulário não representa aprovação ou concessão de
        crédito. Qualquer operação está sujeita a análise, elegibilidade e às
        condições aplicáveis.
      </p>

      {/* ------------------------------------------------------------------ */}
      {/* CONSENTIMENTO / INFORMAÇÕES                                        */}
      {/* ------------------------------------------------------------------ */}

      <div className="consent-info">
        <span>Consentimento e privacidade</span>

        <div>
          <a href="/termos-de-uso" target="_blank" rel="noopener noreferrer">
            Ler Termos de Uso
          </a>

          <span aria-hidden="true">·</span>

          <a
            href="/politica-de-privacidade"
            target="_blank"
            rel="noopener noreferrer"
          >
            Ler Política de Privacidade
          </a>
        </div>
      </div>
    </form>
  );
}
