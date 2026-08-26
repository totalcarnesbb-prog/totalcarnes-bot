const express = require("express");
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(">>> Peticion recibida: " + req.method + " " + req.path);
  if (req.method === "POST") {
    console.log(">>> Body recibido:", JSON.stringify(req.body));
  }
  next();
});

const VERIFY_TOKEN = "totalcarnes2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const yaSaludados = new Set();

const BIENVENIDA = "Hola! Bienvenido a Total Carnes. Soy el asistente automatico, te puedo ayudar con horarios, ubicacion, formas de pago y promociones.";

// Toda la info real del negocio, que la IA va a usar como unica fuente de verdad.
const INFO_NEGOCIO = `
Sos el asistente de WhatsApp de "Total Carnes", una carniceria.

DATOS DEL NEGOCIO (usa solo esta informacion, nunca inventes nada que no este aca):
- Horario: todos los dias de 9 a 21hs.
- Dias que permanecen CERRADOS (excepcion al horario normal): 25 de diciembre, 1 de enero, Viernes Santo y 1 de mayo. Solo menciona estos cierres si preguntan puntualmente por esa fecha o por feriados; en una pregunta general de horario NO los menciones.
- Direccion: Hipolito Yrigoyen 3884.
- No hacen envios a domicilio, la atencion es solo en el local.
- Formas de pago: efectivo, debito, credito, Mercado Pago y QR.
- No toman pedidos por WhatsApp; el cliente tiene que ir al local a elegir su corte.
- Promociones vigentes:
  * Lunes a viernes: 10% off pagando en efectivo.
  * Lunes a viernes: 20% off pagando con Cuenta DNI (tope de reintegro $6.000 por persona por semana).
  * Jueves: 10% off en todas las milanesas.
  * Sabado y domingo: 50% off en hamburguesas.
- Los precios de los cortes todavia no estan disponibles por este medio; si preguntan un precio especifico, respondeles que por ahora no tenes esa info cargada y que un empleado se los va a pasar.

INSTRUCCIONES DE ESTILO:
- Respondes en español rioplatense, como un empleado amable de la carniceria.
- Se breve: 1 a 3 oraciones, sin relleno.
- No uses markdown ni asteriscos para negritas (esto es WhatsApp, se ve mal el markdown ahi). Los saltos de linea si podes usarlos si hace falta una lista corta.
- Si la pregunta no tiene nada que ver con el negocio (por ejemplo pide una receta, chiste, opinion politica, etc), respondes amablemente que solo podes ayudar con consultas de la carniceria.
- Si la pregunta no la podes responder con la info de arriba (por ejemplo algo muy especifico que no sabes), decis que ya le avisaste a un empleado para que responda en breve. No inventes datos que no esten en la lista de arriba.
`.trim();

async function generarRespuestaIA(textoCliente) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      system: INFO_NEGOCIO,
      messages: [{ role: "user", content: textoCliente }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.log(">>> Error de la API de Claude:", resp.status, errText);
    return "Gracias por tu mensaje. Ya le avisamos a un empleado para que te responda en breve.";
  }

  const data = await resp.json();
  const texto = data.content && data.content[0] && data.content[0].text;
  return texto || "Gracias por tu mensaje. Ya le avisamos a un empleado para que te responda en breve.";
}

function normalizarNumeroAR(numero) {
  if (numero.indexOf("549") === 0) {
    return "54" + numero.substring(3);
  }
  return numero;
}

async function enviarMensaje(numeroDestino, texto) {
  var numeroFinal = normalizarNumeroAR(numeroDestino);
  const url = "https://graph.facebook.com/v20.0/" + PHONE_NUMBER_ID + "/messages";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + WHATSAPP_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: numeroFinal,
      text: { body: texto },
    }),
  });
  const data = await resp.text();
  console.log(">>> Respuesta de Meta al enviar mensaje:", resp.status, data);
}

app.get("/privacidad", (req, res) => {
  res.send(
    "<html><head><meta charset=\"utf-8\"><title>Politica de Privacidad - Total Carnes</title></head>" +
    "<body style=\"font-family: sans-serif; max-width: 700px; margin: 40px auto; line-height: 1.6; padding: 0 20px;\">" +
    "<h1>Politica de Privacidad</h1>" +
    "<p><strong>Total Carnes</strong> utiliza un asistente automatico de WhatsApp para responder consultas de clientes (horarios, ubicacion, formas de pago y promociones).</p>" +
    "<h2>Datos que recolectamos</h2>" +
    "<p>Cuando nos escribis por WhatsApp, recibimos tu numero de telefono y el contenido de tus mensajes, unicamente para poder responderte.</p>" +
    "<h2>Uso de los datos</h2>" +
    "<p>Estos datos se usan solo para responder tus consultas. No los compartimos con terceros, salvo con Meta/WhatsApp como proveedor de la infraestructura de mensajeria, y con Anthropic (Claude) como proveedor de inteligencia artificial que genera las respuestas.</p>" +
    "<h2>Conservacion</h2>" +
    "<p>No almacenamos un historial permanente de conversaciones mas alla de lo necesario para operar el servicio.</p>" +
    "<h2>Contacto</h2>" +
    "<p>Ante cualquier consulta sobre esta politica, podes escribirnos a totalcarnes.bb@gmail.com.</p>" +
    "</body></html>"
  );
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const mensaje = change && change.value && change.value.messages && change.value.messages[0];

    if (mensaje && mensaje.type === "text") {
      const numero = mensaje.from;
      const texto = mensaje.text.body;

      if (!yaSaludados.has(numero)) {
        yaSaludados.add(numero);
        await enviarMensaje(numero, BIENVENIDA);
      }

      const respuesta = await generarRespuestaIA(texto);
      await enviarMensaje(numero, respuesta);
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error procesando mensaje:", err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot de Total Carnes corriendo en puerto " + PORT));
