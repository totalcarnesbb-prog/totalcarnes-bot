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
const SIPROF_URL = process.env.SIPROF_URL || "http://totalcarnes.ddns.net:53080/api/precios.php";
const SIPROF_TOKEN = process.env.SIPROF_TOKEN;

const NUMERO_DUENO = "5492915765295";
const HORAS_PAUSA_MS = 60 * 60 * 1000; // 1 hora
const RESPUESTAS_PARA_RESENA = 6; // recien se pide resena en conversaciones largas y utiles
const HORAS_INACTIVIDAD_RESET_MS = 3 * 60 * 60 * 1000; // despues de 3hs sin escribir, se considera charla nueva
const MENSAJES_HISTORIAL_MAX = 12; // cuantos mensajes (entre cliente y bot) recordamos como maximo por conversacion
const INTENTOS_HERRAMIENTA_MAX = 5; // limite de vueltas de "buscar precio" por respuesta, para no colgarnos
const PROMETE_CONSULTAR = /(dame|danos|un) (un )?segundo|consultando|enseguida te|perm[ií]teme|te busco|ya te (paso|busco|consulto)|busco los/i;

const yaSaludados = new Set();
const contadorRespuestas = new Map();
const pausadoHasta = new Map(); // numero del cliente -> timestamp hasta el que el bot no debe intervenir
const historiales = new Map(); // numero del cliente -> { mensajes: [...], ultimaActividad: timestamp }
const mensajesProcesados = new Set(); // ids de mensajes ya atendidos, para no responder duplicados
const textosRecientes = new Map(); // "numero|texto" -> timestamp del ultimo mensaje identico recibido, por si WhatsApp lo reenvia con otro id
const VENTANA_TEXTO_DUPLICADO_MS = 90 * 1000; // si llega el mismo texto del mismo numero en menos de 90s, lo tratamos como reenvio duplicado

const BIENVENIDA = "Hola! Bienvenido a Total Carnes. Soy el asistente automatico, en que te puedo ayudar hoy?";

const LINK_RESENA = "https://g.page/r/CY-t1KzqBCcQEAE/review";
const PEDIDO_RESENA = "\n\nSi te sirvio, nos ayudaria mucho que nos dejes una resena en Google: " + LINK_RESENA;

const LINK_MAPS = "https://www.google.com/maps/search/?api=1&query=Hipolito+Yrigoyen+3884+Bahia+Blanca";

const LINK_YOUTUBE = "https://www.youtube.com/@totalcarnesbb";

const INFO_NEGOCIO = `
Sos el asistente de WhatsApp de "Total Carnes", una carniceria.

DATOS DEL NEGOCIO (usa solo esta informacion, nunca inventes nada que no este aca):
- Horario: todos los dias de 9 a 21hs.
- Dias que permanecen CERRADOS (excepcion al horario normal): 25 de diciembre, 1 de enero, Viernes Santo y 1 de mayo. Solo menciona estos cierres si preguntan puntualmente por esa fecha o por feriados; en una pregunta general de horario NO los menciones.
- Direccion: Hipolito Yrigoyen 3884. Cuando des la direccion o alguien pregunte como llegar, siempre incluis este link de Google Maps al final: ${LINK_MAPS}
- No hacen envios a domicilio, la atencion es solo en el local.
- Formas de pago: efectivo, debito, credito, Mercado Pago y QR. La promo de Cuenta DNI es la billetera virtual del Banco Provincia (Banco de la Provincia de Buenos Aires) - NUNCA digas que es del Banco Nacion ni que es una tarjeta de debito.
- No toman pedidos por WhatsApp; el cliente tiene que ir al local a elegir su corte.

PRODUCTOS:
- Carnes: carne vacuna, cerdo y pollo. Cortes envasados al vacio y tambien cortados en el momento. Ademas, segun disponibilidad, tienen conejo, cabrito, cordero y lechon (aclara que estos ultimos dependen de la disponibilidad del dia).
- Milanesas: de cerdo y de ternera (vacuna). NO hacen milanesas de pollo.
- Hamburguesas: de carne vacuna, de cerdo y de cordero, segun disponibilidad.
- NO venden comidas elaboradas ni preparadas: nada de carne desmechada, sanduches armados o combos listos para comer, pata, ni platos listos. Solo venden la carne cruda para llevar. Si preguntan por algo asi, aclara amablemente que no hacen ese tipo de productos, solo venden cortes de carne. Esto NO aplica al pan de hamburguesa, que si lo venden como producto aparte (ver mas arriba).
- Otros productos que tambien venden (mencionalos SOLO si preguntan puntualmente por alguno de estos, nunca los enumeres todos de forma proactiva ni armes un listado largo sin que lo pidan): pan de hamburguesa (son los pancitos de papa de la marca "level up" - si preguntan por "pan de hamburguesa" o "pan de papa" es este producto, SI lo tienen), huevos, salmuera de la marca "Don Esteban", sal especiada (tienen dos: la marca "Surtrip", que la piden mucho, y "Sal de Campo" - si preguntan por sal especiada, sal para asado o condimentada, decile que SI tienen y nombrale las dos; para buscar el precio usa "surtrip" y "sal de campo" como nombres de busqueda), ensaladas, leña, carbon, pan, snacks, productos de la marca "Las Dinas" (fiambres y demas), pastas de "Joselito", helados "Freddo" y "Fra Nui", milanesas de soja rellenas, papas congeladas, pizzas congeladas de "Tonal y Nagual", condimentos, verduras congeladas, rebozados de pollo, fiambres y picada, bebidas, una seleccion de vinos de la marca "La Perla", y cervezas.
- Si preguntan el precio de algun producto, usa la herramienta buscar_precio para consultarlo en el sistema real de la carniceria antes de responder. Nunca inventes ni supongas un precio. Si la herramienta no encuentra el producto, ANTES de rendirte volve a buscar una vez mas con un nombre mas corto o un sinonimo (por ejemplo solo "cuadril" en vez de "cuadril sin tapa", o "asado" en vez de "asado con hueso"). Si igual no aparece, o devuelve un error, decile: "Disculpa, no encontre el precio de [producto]. En el local te van a poder ayudar." NUNCA digas que le avisaste a un empleado ni que alguien le va a pasar el precio, porque nadie atiende los mensajes. Si preguntan por varios productos en el mismo mensaje, llama a la herramienta una vez por cada producto, todas juntas en la misma respuesta. NUNCA digas "dame un segundo", "consultando", "enseguida te busco" ni nada parecido: si necesitas un precio, llama a la herramienta DE INMEDIATO, sin avisar antes, y contesta una sola vez con los precios ya encontrados.
- Si preguntan si tienen o venden un producto que NO esta en la lista de arriba (una marca, un condimento, un acompanamiento, etc), NUNCA contestes que no lo venden sin antes buscarlo con la herramienta buscar_precio. Si aparece en el sistema, decile que SI lo tienen (y el precio si lo pidio). Solo si no aparece despues de buscar (probando tambien con un nombre mas corto), decile que no lo encontraste y que en el local lo pueden ayudar. Esto NO aplica a comidas preparadas ni a pan de hamburguesa de otras marcas, que siguen las reglas de arriba, ni a los acompanamientos genericos de la regla siguiente.
- ACOMPANAMIENTOS GENERICOS (condimentos, aderezos, salsas, mayonesa, mostaza, ketchup, snacks y cosas similares para acompanar las carnes): las marcas y productos cambian seguido segun lo que entregan los proveedores, asi que NO los busques en el sistema, NO confirmes ni niegues una marca o producto puntual, y NO des precios. Si preguntan por alguno, contesta algo como: "Tenemos varios productos como condimentos, aderezos, snacks y todo lo que podes necesitar para acompanar tus carnes, pero no puedo confirmarte marcas ni precios por este medio. En el local te van a poder ayudar." (en tus palabras, breve). Las excepciones son la salmuera Don Esteban y la sal especiada (Surtrip y Sal de Campo), que si podes confirmar y buscar por nombre.
- REGLAS PARA MOSTRAR PRECIOS (el sistema a veces devuelve productos viejos o que ya no se venden): cuando el cliente pregunta por un corte de carne vacuna (asado, vacio, lomo, etc), IGNORA y NO menciones ningun resultado que cueste menos de $15.000 el kilo, porque seguramente es un producto viejo. Esta regla NO aplica a cerdo, pollo, cordero, hamburguesas, milanesas, huevos, pan, fiambres, bebidas ni otros productos que normalmente cuestan menos de eso. Si despues de ignorar esos resultados no queda ninguno, deci: "Disculpa, no encontre el precio de [producto]. En el local te van a poder ayudar."
- ASADO: si el cliente pregunta el precio del "asado" en general (sin decir cual), contesta SOLO el precio del "Asado Premium" ("asado premium" en el sistema), en una sola linea, sin listar ni nombrar las otras variedades (king, ventana, banderita, centro de asado, tapa de asado). Solo si pregunta puntualmente por otra variedad (king, ventana, banderita, centro de asado, tapa de asado/brisket) o pide ver las otras opciones o las variedades de asado, da el precio de esa o de todas las que pida.
- NOMBRES EN EL SISTEMA (el cliente usa un nombre y en el sistema se llama distinto, busca con el nombre del sistema): "matambre de cerdo" se busca como "matambrito".
- PRECIO DE HAMBURGUESAS: si preguntan el precio de las hamburguesas o "burger", o vienen por la "promo" desde instagram, consulta la herramienta buscar_precio. IMPORTANTE: en el sistema las hamburguesas se llaman "BURGER" (por ejemplo "BURGER CERDO"), asi que NUNCA busques "hamburguesa" (eso devuelve el pan de hamburguesa, que es otro producto): busca "burger", y ademas busca por separado "burger vacuna" y "burger cordero" si no aparecieron en el primer resultado (el nombre exacto puede variar, por ejemplo "BURGER ORIGINAL" para la de carne vacuna). El precio que devuelve el sistema es el precio de LISTA por kilo, sin descuento. Mira la FECHA Y HORA ACTUAL que te paso al final de estas instrucciones:
  - Si hoy es viernes, sabado o domingo: aplicale el 50% de descuento (dividi el precio de lista por 2) y deci el precio final con descuento, aclarando que es con el 50% off de hoy.
  - Cualquier otro dia: deci el precio de lista y menciona que viernes, sabado y domingo tienen 50% off en hamburguesas.
  - Cada hamburguesa pesa 200g y vienen en paquetes de 2 unidades (400g por paquete). Ademas del precio por kilo, deci el precio por paquete (precio por kilo x 0,4).
  - Las hamburguesas propias son solo las de carne vacuna, de cerdo y de cordero (las "BURGER"). El 50% off aplica SOLO a esas.
  - Ademas venden hamburguesas de la marca Union Ganadera (UG), envasadas: en el sistema figuran como "UG HAMBURGUESA 83g x4" (4 hamburguesas de 83g), "UG HAMBURGUESA 83g x12", "UG HAMBURGUESA 83g x20" y "UG HAMBURGUESA parrillera 120g x2u" (2 hamburguesas de 120g). Para buscarlas usa "UG hamburguesa". Si el cliente pregunta por el precio de las hamburguesas en general, da primero el de las propias (BURGER) y mencionale tambien las de la marca UG con su precio. Si pregunta puntualmente por las UG, da el precio de cada presentacion tal como lo devuelve el sistema (es el precio por paquete/unidad que figura ahi) SIN aplicarles el 50% de descuento. Ignora cualquier otro resultado que no sea de estas hamburguesas (por ejemplo el pan de hamburguesa).

PROMOCIONES VIGENTES (son excluyentes entre si: es una promo o la otra, nunca se acumulan. IMPORTANTE: no expliques ni aclares esto al cliente de ninguna forma -no digas "son excluyentes", "no se acumulan", "ten en cuenta que" ni nada similar-, simplemente listalas de forma independiente, cada una como un dato separado, sin conectarlas entre si):
- Lunes a viernes: 10% off pagando en efectivo.
- Lunes a viernes: 20% off pagando con Cuenta DNI (tope de reintegro $6.000 por persona por semana).
- Jueves: 10% off en todas las milanesas.
- Viernes, sabado y domingo: 50% off en hamburguesas.

RECOMENDACIONES, CANTIDADES Y RECETAS:
- Si te preguntan que corte conviene para tal ocasion (asado, milanesas, guiso, etc) o cuanta carne calcular para X personas, podes responder usando tu conocimiento general de cocina y parrilla argentina (por ejemplo: para asado calcula 400-500g de carne por persona como guia general). Aclara que es una guia orientativa, no una regla exacta. Esto es independiente de la disponibilidad real en el local: no confirmes que un corte especifico esta disponible hoy, eso lo confirma un empleado.
- Si preguntan como cocinar o preparar algun corte en particular, o piden una receta, invitalos a ver el canal de YouTube de Total Carnes, que tiene videos con recetas: ${LINK_YOUTUBE}. Podes dar alguna sugerencia breve tambien si queres, pero siempre menciona el canal como el lugar donde van a encontrar el paso a paso completo.

CASOS PARTICULARES:
- Si alguien pregunta como enviar un curriculum / busca trabajo, decile que puede mandarlo a cv.totalcarnes@gmail.com.
- Si el mensaje es de alguien ofreciendo mercaderia, una lista de precios de una distribuidora, o algun producto (es decir, un proveedor contactando al negocio), aclarale amablemente que sos un asistente virtual y que para eso puede pasar por el local o mandar su propuesta a totalcarnes.bb@gmail.com.
- Si te piden una colaboracion o donacion para un evento (bingo, rifa, torneo, etc de un club, escuela u organizacion), agradece el mensaje, decile que por el momento no pueden sumarse con colaboraciones, y deseale exito con el evento. No menciones que ya hacen donaciones en otro lado ni des explicaciones de mas.

INSTRUCCIONES DE ESTILO:
- Tenes memoria de los mensajes anteriores de esta misma conversacion (te los paso como contexto). Usala: no repitas la misma respuesta genérica si el cliente ya te dio mas detalles o ya te escribio antes, segui el hilo de la charla de forma natural.
- IMPORTANTE: antes de que vos respondas, el sistema ya le mando automaticamente al cliente un mensaje de bienvenida (algo como "Hola! Bienvenido a Total Carnes, en que te puedo ayudar?"). Por eso, si el mensaje del cliente es solo un saludo generico sin pregunta concreta (hola, buenas, buen dia, etc), NO respondas con otro saludo tipo "Hola" de nuevo. En ese caso respondes simplemente algo breve como "Decime en que te puedo ayudar" o "Te escucho", sin repetir el saludo.
- Respondes en español rioplatense, como un empleado amable de la carniceria.
- Se breve: 1 a 3 oraciones, sin relleno.
- No uses markdown ni asteriscos para negritas (esto es WhatsApp, se ve mal el markdown ahi). Los saltos de linea si podes usarlos si hace falta una lista corta.
- Si la pregunta no tiene nada que ver con el negocio (por ejemplo pide un chiste, opinion politica, etc), respondes amablemente que solo podes ayudar con consultas de la carniceria.
- Si la pregunta no la podes responder con la info de arriba (por ejemplo algo muy especifico que no sabes), decis amablemente que no tenes ese dato y que en el local lo van a poder ayudar (no digas que avisaste a un empleado, nadie atiende los mensajes). No inventes datos que no esten en la lista de arriba.
- Si el mensaje del cliente es un RECLAMO o QUEJA (producto en mal estado, mala atencion, un problema con su compra, etc), tu respuesta tiene que EMPEZAR (como primer caracter, sin nada antes) con la etiqueta exacta [RECLAMO], seguida de una respuesta empatica pidiendole disculpas y avisandole que ya se lo derivaste a un encargado para resolverlo. Esto aplica tambien si el reclamo sigue una conversacion anterior (por ejemplo, si ya te habia contado el problema y ahora te da mas detalles): seguí poniendo la etiqueta [RECLAMO] en cada respuesta mientras siga siendo parte de ese mismo reclamo, no la pongas una sola vez y despues te olvides.
- Si el cliente pide explicitamente hablar con una persona, dice que es urgente, o necesita comunicarse ya mismo con alguien del local (mas alla de si es un reclamo o no), tu respuesta tiene que EMPEZAR (como primer caracter, sin nada antes) con la etiqueta exacta [URGENTE], seguida de una respuesta amable confirmandole que ya avisaste a un encargado y que se van a comunicar con el a la brevedad.
- Para cualquier otra consulta normal, NO uses ninguna de esas dos etiquetas.
`.trim();

const HERRAMIENTAS = [
  {
    name: "buscar_precio",
    description:
      "Busca el precio de un producto en el sistema real de la carniceria (SIPROF). Usala cada vez que el cliente pregunte cuanto sale, cuanto cuesta, o el precio de algun producto. Nunca inventes un precio sin usar esta herramienta primero.",
    input_schema: {
      type: "object",
      properties: {
        consulta: {
          type: "string",
          description:
            "Nombre del producto a buscar, en pocas palabras, tal como lo menciono el cliente (por ejemplo: 'asado', 'milanesa de ternera', 'vacio').",
        },
      },
      required: ["consulta"],
    },
  },
];

async function consultarPrecio(consulta) {
  try {
    const url = SIPROF_URL + "?formato=texto&q=" + encodeURIComponent(consulta);
    const resp = await fetch(url, {
      headers: {
        Authorization: "Bearer " + SIPROF_TOKEN,
      },
    });
    const texto = await resp.text();

    if (!resp.ok) {
      console.log(">>> Error consultando precio en SIPROF:", resp.status, texto);
      return "No se pudo consultar el precio en este momento (error del sistema).";
    }

    console.log(">>> Consulta de precio '" + consulta + "' -> " + texto);
    return texto;
  } catch (err) {
    console.log(">>> Excepcion consultando precio en SIPROF:", err.message);
    return "No se pudo consultar el precio en este momento (no se pudo conectar al sistema).";
  }
}

function fechaActualAR() {
  return new Date().toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function obtenerHistorial(numero) {
  const existente = historiales.get(numero);
  const ahora = Date.now();

  if (!existente || (ahora - existente.ultimaActividad) > HORAS_INACTIVIDAD_RESET_MS) {
    const nuevo = { mensajes: [], ultimaActividad: ahora };
    historiales.set(numero, nuevo);
    return nuevo;
  }

  existente.ultimaActividad = ahora;
  return existente;
}

function agregarAlHistorial(historial, rol, texto) {
  historial.mensajes.push({ role: rol, content: texto });
  if (historial.mensajes.length > MENSAJES_HISTORIAL_MAX) {
    historial.mensajes = historial.mensajes.slice(-MENSAJES_HISTORIAL_MAX);
  }
}

async function generarRespuestaIA(textoCliente, numero) {
  const FALLBACK = "Disculpa, no pude procesar tu mensaje en este momento. En el local te van a poder ayudar.";

  const historial = obtenerHistorial(numero);
  agregarAlHistorial(historial, "user", textoCliente);

  // Copia de trabajo: acá se van agregando las idas y vueltas con la herramienta de precios,
  // pero eso NO se guarda en el historial permanente de la conversación (solo se guarda el texto final).
  let mensajesParaClaude = historial.mensajes.slice();

  let texto = null;
  let consultoPrecios = false;
  let forzarHerramienta = false;

  for (let intento = 0; intento < INTENTOS_HERRAMIENTA_MAX; intento++) {
    const cuerpo = {
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      system: INFO_NEGOCIO + "\n\nFECHA Y HORA ACTUAL (Argentina): " + fechaActualAR() + ".",
      tools: HERRAMIENTAS,
      messages: mensajesParaClaude,
    };

    // Si la IA dijo "dame un segundo" sin consultar nada, la obligamos a usar la herramienta.
    if (forzarHerramienta) {
      cuerpo.tool_choice = { type: "any" };
      forzarHerramienta = false;
    }

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cuerpo),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.log(">>> Error de la API de Claude:", resp.status, errText);
      return { texto: FALLBACK, avisar: false };
    }

    const data = await resp.json();
    const bloques = data.content || [];
    const usos = bloques.filter((b) => b.type === "tool_use");

    // La IA pidio buscar uno o varios precios (puede pedir varios a la vez, por ejemplo 8 cortes).
    if (data.stop_reason === "tool_use" && usos.length > 0) {
      consultoPrecios = true;

      const resultados = await Promise.all(
        usos.map(async (uso) => ({
          type: "tool_result",
          tool_use_id: uso.id,
          content: await consultarPrecio((uso.input && uso.input.consulta) || ""),
        }))
      );

      mensajesParaClaude.push({ role: "assistant", content: bloques });
      mensajesParaClaude.push({ role: "user", content: resultados });

      continue; // volvemos a llamar a Claude, ahora con los precios
    }

    const bloqueTexto = bloques.find((b) => b.type === "text");
    const candidato = bloqueTexto && bloqueTexto.text;

    // Prometio buscar precios pero no llamo a la herramienta: reintentamos obligandola.
    if (
      candidato &&
      !consultoPrecios &&
      PROMETE_CONSULTAR.test(candidato) &&
      intento < INTENTOS_HERRAMIENTA_MAX - 1
    ) {
      console.log(">>> La IA prometio consultar sin hacerlo, reintento forzando la herramienta: " + candidato);
      forzarHerramienta = true;
      continue;
    }

    texto = candidato;
    break;
  }

  if (!texto) {
    return { texto: FALLBACK, avisar: false };
  }

  agregarAlHistorial(historial, "assistant", texto);

  // Buscamos las etiquetas en cualquier parte del texto (no solo al principio),
  // por si la IA agrega algo antes a pesar de la instruccion.
  let motivo = null;
  if (texto.indexOf("[RECLAMO]") !== -1) {
    motivo = "Reclamo";
    texto = texto.split("[RECLAMO]").join("").trim();
  } else if (texto.indexOf("[URGENTE]") !== -1) {
    motivo = "Urgente";
    texto = texto.split("[URGENTE]").join("").trim();
  }

  if (texto.trim() === FALLBACK || motivo) {
    return { texto: texto, avisar: motivo };
  }

  const cantidadPrevia = contadorRespuestas.get(numero) || 0;
  const cantidadNueva = cantidadPrevia + 1;
  contadorRespuestas.set(numero, cantidadNueva);

  if (cantidadNueva === RESPUESTAS_PARA_RESENA) {
    texto = texto + PEDIDO_RESENA;
  }

  return { texto: texto, avisar: false };
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
    "<p><strong>Total Carnes</strong> utiliza un asistente automatico de WhatsApp para responder consultas de clientes (horarios, ubicacion, formas de pago, promociones y precios).</p>" +
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

    // Caso 1: vos (o un empleado) le escribio manualmente al cliente desde la app de WhatsApp Business.
    // Pausamos el bot para ese numero durante 1 hora.
    if (change && change.field === "smb_message_echoes") {
      const echo = change.value && change.value.message_echoes && change.value.message_echoes[0];
      if (echo && echo.to) {
        pausadoHasta.set(echo.to, Date.now() + HORAS_PAUSA_MS);
        console.log(">>> Pausando bot para " + echo.to + " por 1 hora (respuesta manual detectada)");
      }
      res.sendStatus(200);
      return;
    }

    // Caso 2: mensaje normal de un cliente.
    const mensaje = change && change.value && change.value.messages && change.value.messages[0];

    if (mensaje && mensaje.type === "text") {
      const numero = mensaje.from;
      const texto = mensaje.text.body;

      // Meta a veces reenvia el mismo mensaje si el servidor tardo en responder
      // (por ejemplo, si estaba "dormido"). Si ya lo procesamos, lo ignoramos.
      if (mensaje.id && mensajesProcesados.has(mensaje.id)) {
        console.log(">>> Mensaje duplicado ignorado: " + mensaje.id);
        res.sendStatus(200);
        return;
      }
      if (mensaje.id) {
        mensajesProcesados.add(mensaje.id);
      }

      // A veces WhatsApp reenvia el mensaje del cliente con un id distinto (por un corte de conexion, etc).
      // Si llega el mismo texto del mismo numero muy seguido, lo tratamos como el mismo mensaje.
      const claveTexto = numero + "|" + texto.trim().toLowerCase();
      const ultimaVezTexto = textosRecientes.get(claveTexto);
      if (ultimaVezTexto && (Date.now() - ultimaVezTexto) < VENTANA_TEXTO_DUPLICADO_MS) {
        console.log(">>> Mensaje identico reenviado muy rapido, lo ignoro: " + claveTexto);
        res.sendStatus(200);
        return;
      }
      textosRecientes.set(claveTexto, Date.now());

      // Comando solo para el dueño: "/precio asado" devuelve el texto crudo que manda SIPROF (sin IA).
      if (numero === NUMERO_DUENO && texto.trim().toLowerCase().indexOf("/precio ") === 0) {
        const consulta = texto.trim().substring(8).trim();
        const crudo = await consultarPrecio(consulta);
        await enviarMensaje(numero, "[SIPROF] " + consulta + ":\n" + crudo);
        res.sendStatus(200);
        return;
      }

      const hastaCuando = pausadoHasta.get(numero);
      if (hastaCuando && hastaCuando > Date.now()) {
        console.log(">>> Bot pausado para " + numero + ", no intervengo.");
        res.sendStatus(200);
        return;
      }

      if (!yaSaludados.has(numero)) {
        yaSaludados.add(numero);
        await enviarMensaje(numero, BIENVENIDA);
      }

      const resultado = await generarRespuestaIA(texto, numero);
      await enviarMensaje(numero, resultado.texto);

      if (resultado.avisar) {
        await enviarMensaje(
          NUMERO_DUENO,
          resultado.avisar + " de " + numero + ":\n" + texto
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
