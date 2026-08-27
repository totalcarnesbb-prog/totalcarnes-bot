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

const NUMERO_DUENO = "5492915765295";

const yaSaludados = new Set();

const BIENVENIDA = "Hola! Bienvenido a Total Carnes. Soy el asistente automatico, en que te puedo ayudar hoy?";

const LINK_RESENA = "https://g.page/r/CY-t1KzqBCcQEAE/review";
const PEDIDO_RESENA = "\n\nSi te sirvio, nos ayudaria mucho que nos dejes una resena en Google: " + LINK_RESENA;

const LINK_MAPS = "https://www.google.com/maps/search/?api=1&query=Hipolito+Yrigoyen+3884+Bahia+Blanca";

const INFO_NEGOCIO = `
Sos el asistente de WhatsApp de "Total Carnes", una carniceria.

DATOS DEL NEGOCIO (usa solo esta informacion, nunca inventes nada que no este aca):
- Horario: todos los dias de 9 a 21hs.
- Dias que permanecen CERRADOS (excepcion al horario normal): 25 de diciembre, 1 de enero, Viernes Santo y 1 de mayo. Solo menciona estos cierres si preguntan puntualmente por esa fecha o por feriados; en una pregunta general de horario NO los menciones.
- Direccion: Hipolito Yrigoyen 3884. Cuando des la direccion o alguien pregunte como llegar, siempre incluis este link de Google Maps al final: ${LINK_MAPS}
- No hacen envios a domicilio, la atencion es solo en el local.
- Formas de pago: efectivo, debito, credito, Mercado Pago y QR.
- No toman pedidos por WhatsApp; el cliente tiene que ir al local a elegir su corte.
- Productos: carne vacuna, cerdo y pollo. Cortes envasados al vacio y tambien cortados en el momento. Ademas, segun disponibilidad, tienen conejo, cabrito, cordero y lechon (aclara que estos ultimos dependen de la disponibilidad del dia).
- NO venden comidas elaboradas ni preparadas: nada de carne desmechada, combos o sanduches con pan, pata, ni platos listos. Solo venden la carne cruda para llevar. Si preguntan por algo asi, aclara amablemente que no hacen ese tipo de productos, solo venden cortes de carne.
- Promociones vigentes:
  * Lunes a viernes: 10% off pagando en efectivo.
  * Lunes a viernes: 20% off pagando con Cuenta DNI (tope de reintegro $6.000 por persona por semana).
  * Jueves: 10% off en todas las milanesas.
  * Sabado y domingo: 50% off en hamburguesas.
- Los precios de los cortes todavia no estan disponibles por este medio; si preguntan un precio especifico, respondeles que por ahora no tenes esa info cargada y que un empleado se los va a pasar.

RECOMENDACIONES Y CALCULO DE CANTIDADES:
- Si te preguntan que corte conviene para tal ocasion (asado, milanesas, guiso, etc) o cuanta carne calcular para X personas, podes responder usando tu conocimiento general de cocina y parrilla argentina (por ejemplo: para asado calcula 400-500g de carne por persona como guia general).
- Aclara que es una guia orientativa, no una regla exacta.
- Esto es independiente de la disponibilidad real en el local: no confirmes que un corte especifico esta disponible hoy, eso lo confirma un empleado.

INSTRUCCIONES DE ESTILO:
- Respondes en español rioplatense, como un empleado amable de la carniceria.
- Se breve: 1 a 3 oraciones, sin relleno.
- No uses markdown ni asteriscos para negritas (esto es WhatsApp, se ve mal el markdown ahi). Los saltos de linea si podes usarlos si hace falta una lista corta.
- Si la pregunta no tiene nada que ver con el negocio (por ejemplo pide una receta, chiste, opinion politica, etc), respondes amablemente que solo podes ayudar con consultas de la carniceria.
- Si la pregunta no la podes responder con la info de arriba (por ejemplo algo muy especifico que no sabes), decis que ya le avisaste a un empleado para que responda en breve. No inventes datos que no esten en la lista de arriba.
- Si el mensaje del cliente es un RECLAMO o QUEJA (producto en mal estado, mala atencion, un problema con su compra, etc), empeza tu respuesta con la etiqueta exacta [RECLAMO] al principio (sin nada mas antes), seguida de una respuesta empatica pidiendole disculpas y avisandole que ya se lo derivaste a un encargado para resolverlo. Para cualquier otra consulta normal, NO uses esa etiqueta.
`.trim();

async function generarRespuestaIA(textoCliente) {
  const FALLBACK = "Gracias por tu mensaje. Ya le avisamos a un empleado para que te responda en breve.";

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
    return { texto: FALLBACK, esReclamo: false };
  }

  const data = await resp.json();
  let texto = data.content && data.content[0] && data.content[0].text;

  if (!texto) {
    return { texto: FALLBACK, esReclamo: false };
  }

  const esReclamo = texto.trim().indexOf("[RECLAMO]") === 0;
  if (esReclamo) {
    texto = texto.replace("[RECLAMO]", "").trim();
  }

  if (texto.trim() === FALLBACK || esReclamo) {
    return { texto: texto, esReclamo: esReclamo };
  }

  return { texto: texto + PEDIDO_RESENA, esReclamo: false };
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

      const resultado = await generarRespuestaIA(texto);
      await enviarMensaje(numero, resultado.texto);

      if (resultado.esReclamo) {
        await enviarMensaje(
          NUMERO_DUENO,
          "Reclamo nuevo de " + numero + ":\n" + texto
        );
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error procesando mensaje:", err);
    res.sendStatus(200);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Bot de Total Carnes corriendo en puerto " + PORT));
