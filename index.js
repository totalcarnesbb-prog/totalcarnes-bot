const express = require("express");
const app = express();
app.use(express.json());

// LOG de diagnostico: muestra CUALQUIER peticion que llegue al servidor
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

const yaSaludados = new Set();

const BIENVENIDA = "Hola! Bienvenido a Total Carnes. Soy el asistente automatico, te puedo ayudar con horarios, ubicacion, formas de pago y promociones.";

const RESPUESTAS = [
  { palabras: ["horario", "hora", "abierto", "abren", "cierran"], respuesta: "Abrimos todos los dias de 9 a 21hs." },
  { palabras: ["25 de diciembre", "25/12", "navidad"], respuesta: "El 25 de diciembre permanecemos cerrados." },
  { palabras: ["1 de enero", "1/1", "ano nuevo"], respuesta: "El 1 de enero permanecemos cerrados." },
  { palabras: ["viernes santo", "semana santa"], respuesta: "El Viernes Santo permanecemos cerrados." },
  { palabras: ["1 de mayo", "1/5", "dia del trabajador"], respuesta: "El 1 de mayo permanecemos cerrados." },
  { palabras: ["envio", "envio", "domicilio", "entregan", "reparto"], respuesta: "Por el momento no hacemos envios, la atencion es solo en el local." },
  { palabras: ["direccion", "ubicacion", "donde estan"], respuesta: "Estamos en Hipolito Yrigoyen 3884." },
  { palabras: ["pago", "pagar", "efectivo", "tarjeta", "debito", "credito", "mercado pago", "qr"], respuesta: "Aceptamos efectivo, debito, credito, Mercado Pago y QR." },
  { palabras: ["pedido", "encargar", "reservar"], respuesta: "Por WhatsApp no tomamos pedidos, te esperamos en el local para que elijas tu corte." },
  { palabras: ["promo", "descuento", "oferta"], respuesta: "Estas son nuestras promos vigentes: Lunes a viernes 10% off en efectivo. Lunes a viernes 20% off con Cuenta DNI (tope $6000 por persona/semana). Jueves 10% off en milanesas. Sabado y domingo 50% off en hamburguesas." },
  ];

const NO_ENTENDIDO = "Gracias por tu mensaje. Ya le avisamos a un empleado para que te responda en breve.";

function generarRespuesta(texto) {
    const textoLower = texto.toLowerCase();
    for (const item of RESPUESTAS) {
          if (item.palabras.some((p) => textoLower.includes(p))) {
                  return item.respuesta;
          }
    }
    return NO_ENTENDIDO;
}

async function enviarMensaje(numeroDestino, texto) {
    const url = "https://graph.facebook.com/v20.0/" + PHONE_NUMBER_ID + "/messages";
    const resp = await fetch(url, {
          method: "POST",
          headers: {
                  Authorization: "Bearer " + WHATSAPP_TOKEN,
                  "Content-Type": "application/json",
          },
          body: JSON.stringify({
                  messaging_product: "whatsapp",
                  to: numeroDestino,
                  text: { body: texto },
          }),
    });
    const data = await resp.text();
    console.log(">>> Respuesta de Meta al enviar mensaje:", resp.status, data);
}

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

            const respuesta = generarRespuesta(texto);
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
