import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { ZipArchive } from 'archiver';
import crypto from 'crypto';
import nacl from 'tweetnacl';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const rootDir = process.cwd();

const app = express();
const PORT = 3000;

// Persistent Server JSON Database file
const DB_DIR = path.join(rootDir, 'data');
const DB_FILE = path.join(DB_DIR, 'server_db.json');

interface ServerDatabase {
  pedidos: any[];
  empresaConfig: any | null;
  tiendaConfig: any | null;
  productos: any[] | null;
  inventario: any[] | null;
}

function readServerDb(): ServerDatabase {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    if (fs.existsSync(DB_FILE)) {
      const data = fs.readFileSync(DB_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error reading server DB:', err);
  }
  return {
    pedidos: [],
    empresaConfig: null,
    tiendaConfig: null,
    productos: null,
    inventario: null,
  };
}

function saveServerDb(db: ServerDatabase) {
  try {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving server DB:', err);
  }
}

// Middleware for parsing JSON with generous limit for images and PDFs
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Enable CORS and preflight handling for all /api routes
app.use('/api', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-admin-token, x-requested-with');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

// In-Memory Sliding Window Rate Limiter
interface RateLimitConfig {
  windowMs: number;
  max: number;
  message: string;
}

function createRateLimiter(config: RateLimitConfig) {
  const requests = new Map<string, { count: number; resetTime: number }>();

  // Cleanup expired entries periodically
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of requests.entries()) {
      if (now > record.resetTime) {
        requests.delete(key);
      }
    }
  }, 5 * 60 * 1000);

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    const clientIp = String(rawIp).split(',')[0].trim();
    const now = Date.now();
    const record = requests.get(clientIp);

    if (!record || now > record.resetTime) {
      requests.set(clientIp, { count: 1, resetTime: now + config.windowMs });
      return next();
    }

    record.count++;
    if (record.count > config.max) {
      const retryAfterSec = Math.ceil((record.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSec);
      return res.status(429).json({
        success: false,
        error: config.message,
        retryAfterSeconds: retryAfterSec,
      });
    }

    next();
  };
}

const apiGeneralLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 120,
  message: 'Demasiadas solicitudes al servidor. Por favor espere un momento.',
});

const invoiceRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Límite de análisis de facturas alcanzado (máx 15 por minuto). Espere 60 segundos.',
});

const orderRateLimiter = createRateLimiter({
  windowMs: 5 * 60 * 1000,
  max: 30,
  message: 'Límite de pedidos alcanzado. Por favor espere unos minutos antes de emitir un nuevo pedido.',
});

const licenseRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 15,
  message: 'Demasiadas solicitudes de emisión de licencia. Espere un momento.',
});

// Apply general limiter on all /api routes
app.use('/api', apiGeneralLimiter);

// API Root endpoint: auto-redirects web browsers to POS app (/), returns status for API clients
app.get(['/api', '/api/'], (req, res) => {
  const isBrowser = req.accepts('html') && !req.xhr && !req.headers['x-requested-with'];
  if (isBrowser) {
    return res.redirect('/');
  }
  return res.json({
    success: true,
    name: 'OmniPOS Multi-Sucursal API',
    status: 'online',
    version: '2.0.0',
    time: new Date().toISOString(),
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// API: Consulta automática de Tasa Oficial BCV en tiempo real con caché
let cachedBcvRate: { tasa: number; fecha: string; lastFetched: number } | null = null;

app.get('/api/bcv-rate', async (req, res) => {
  try {
    const now = Date.now();
    // Cache de 10 minutos para proteger cuota y responder a alta velocidad
    if (cachedBcvRate && now - cachedBcvRate.lastFetched < 10 * 60 * 1000) {
      return res.json({
        success: true,
        tasa: cachedBcvRate.tasa,
        fecha: cachedBcvRate.fecha,
        fuente: 'Banco Central de Venezuela (BCV Oficial - Caché)',
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const response = await fetch('https://ve.dolarapi.com/v1/dolares/oficial', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Respuesta HTTP ${response.status} de la API oficial`);
    }

    const data: any = await response.json();
    const tasa = typeof data.promedio === 'number' ? data.promedio : parseFloat(data.promedio);

    if (tasa && !isNaN(tasa) && tasa > 0) {
      cachedBcvRate = {
        tasa: +tasa.toFixed(2),
        fecha: data.fechaActualizacion || new Date().toISOString(),
        lastFetched: now,
      };

      return res.json({
        success: true,
        tasa: cachedBcvRate.tasa,
        fecha: cachedBcvRate.fecha,
        fuente: 'Banco Central de Venezuela (BCV Oficial en Vivo)',
      });
    }

    throw new Error('Formato de tasa inválido devuelto por el servicio.');
  } catch (err: any) {
    console.warn('Aviso: Consulta de tasa BCV en vivo:', err.message);
    if (cachedBcvRate) {
      return res.json({
        success: true,
        tasa: cachedBcvRate.tasa,
        fecha: cachedBcvRate.fecha,
        fuente: 'Banco Central de Venezuela (Última Tasa Registrada)',
      });
    }
    return res.status(503).json({
      success: false,
      error: 'No se pudo obtener la tasa BCV automáticamente: ' + err.message,
    });
  }
});

// API: Obtener todos los pedidos web / online
app.get('/api/pedidos', (req, res) => {
  try {
    const db = readServerDb();
    res.json({ success: true, pedidos: db.pedidos || [] });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Guardar nuevo pedido (creado desde el celular, tablet o laptop) con rate limit y validación estricta
app.post('/api/pedidos', orderRateLimiter, (req, res) => {
  try {
    const pedido = req.body;
    if (!pedido || typeof pedido !== 'object') {
      return res.status(400).json({ success: false, error: 'El cuerpo de la solicitud no contiene un objeto válido.' });
    }

    const clienteNombre = String(pedido.clienteNombre || '').trim();
    if (!clienteNombre || clienteNombre.length < 2 || clienteNombre.length > 150) {
      return res.status(400).json({ success: false, error: 'El nombre del cliente es obligatorio (2-150 caracteres).' });
    }

    if (!Array.isArray(pedido.items) || pedido.items.length === 0) {
      return res.status(400).json({ success: false, error: 'El pedido debe contener al menos un renglón o producto.' });
    }

    if (pedido.items.length > 200) {
      return res.status(400).json({ success: false, error: 'El pedido excede el máximo de 200 renglones permitidos.' });
    }

    const totalUsd = Number(pedido.totalUsd);
    if (isNaN(totalUsd) || totalUsd < 0) {
      return res.status(400).json({ success: false, error: 'El total del pedido (USD) debe ser un monto numérico positivo.' });
    }

    // Sanitizar datos del pedido
    const cleanPedido = {
      ...pedido,
      id: String(pedido.id || ('ped_' + Date.now())).replace(/[^a-zA-Z0-9_\-]/g, ''),
      numeroPedido: String(pedido.numeroPedido || ('PED-' + Date.now())).slice(0, 30),
      clienteNombre: clienteNombre.slice(0, 150),
      clienteTelefono: String(pedido.clienteTelefono || '').slice(0, 35),
      direccionEntrega: String(pedido.direccionEntrega || '').slice(0, 300),
      estado: ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado', 'facturado'].includes(pedido.estado)
        ? pedido.estado
        : 'pendiente',
      totalUsd: +totalUsd.toFixed(2),
      fecha: pedido.fecha || new Date().toISOString(),
    };

    const db = readServerDb();
    if (!Array.isArray(db.pedidos)) {
      db.pedidos = [];
    }
    const existingIndex = db.pedidos.findIndex((p: any) => p.id === cleanPedido.id);
    if (existingIndex >= 0) {
      db.pedidos[existingIndex] = cleanPedido;
    } else {
      db.pedidos.unshift(cleanPedido);
    }
    saveServerDb(db);
    console.log(`[PEDIDO RECIBIDO] ${cleanPedido.numeroPedido} por ${cleanPedido.clienteNombre} ($${cleanPedido.totalUsd})`);
    return res.json({ success: true, pedido: cleanPedido });
  } catch (err: any) {
    console.error('Error al guardar pedido online:', err);
    return res.status(500).json({ success: false, error: 'Error interno al procesar el pedido.' });
  }
});

// API: Actualizar estado de pedido con validación de estados permitidos
const VALID_PEDIDO_STATES = ['pendiente', 'confirmado', 'en_camino', 'entregado', 'cancelado', 'facturado'];

app.patch('/api/pedidos/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (!id || typeof id !== 'string' || id.length > 80) {
      return res.status(400).json({ success: false, error: 'Identificador de pedido inválido.' });
    }

    const { estado, detallePago, correlativoFactura } = req.body;
    if (estado && !VALID_PEDIDO_STATES.includes(estado)) {
      return res.status(400).json({
        success: false,
        error: `Estado inválido. Valores permitidos: ${VALID_PEDIDO_STATES.join(', ')}`,
      });
    }

    const db = readServerDb();
    if (!Array.isArray(db.pedidos)) db.pedidos = [];
    const index = db.pedidos.findIndex((p: any) => p.id === id);
    if (index >= 0) {
      if (estado) db.pedidos[index].estado = estado;
      if (detallePago) db.pedidos[index].detallePago = String(detallePago).slice(0, 200);
      if (correlativoFactura) db.pedidos[index].correlativoFactura = String(correlativoFactura).slice(0, 50);
      saveServerDb(db);
      return res.json({ success: true, pedido: db.pedidos[index] });
    }
    return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
  } catch (err: any) {
    console.error('Error al actualizar estado del pedido:', err);
    return res.status(500).json({ success: false, error: 'Error interno al actualizar pedido.' });
  }
});

// API: Sincronización de estado general entre dispositivos (productos, tasa, config)
app.get('/api/sync/state', (req, res) => {
  try {
    const db = readServerDb();
    res.json({
      success: true,
      pedidos: db.pedidos || [],
      empresaConfig: db.empresaConfig || null,
      tiendaConfig: db.tiendaConfig || null,
      productos: db.productos || null,
      inventario: db.inventario || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Error interno al obtener sincronización.' });
  }
});

app.post('/api/sync/state', (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ success: false, error: 'Cuerpo de sincronización inválido.' });
    }

    const { empresaConfig, tiendaConfig, productos, inventario, pedidos } = req.body;
    const db = readServerDb();

    if (empresaConfig && typeof empresaConfig === 'object') {
      db.empresaConfig = empresaConfig;
    }
    if (tiendaConfig && typeof tiendaConfig === 'object') {
      db.tiendaConfig = tiendaConfig;
    }
    if (Array.isArray(productos)) {
      db.productos = productos;
    }
    if (Array.isArray(inventario)) {
      db.inventario = inventario;
    }
    if (Array.isArray(pedidos)) {
      const map = new Map();
      (db.pedidos || []).forEach((p: any) => map.set(p.id, p));
      pedidos.forEach((p: any) => {
        if (p && p.id) map.set(p.id, p);
      });
      db.pedidos = Array.from(map.values()).sort(
        (a, b) => new Date(b.fecha || 0).getTime() - new Date(a.fecha || 0).getTime()
      );
    }
    saveServerDb(db);
    res.json({ success: true });
  } catch (err: any) {
    console.error('Error al sincronizar estado:', err);
    res.status(500).json({ success: false, error: 'Error interno en sincronización.' });
  }
});

// Download full repository as a .zip file (Protected - requires developer authorization token)
app.get('/api/download-zip', (req, res) => {
  try {
    const devToken = (req.query.token as string) || (req.headers['x-admin-token'] as string);
    const validSecret = process.env.ADMIN_DEV_KEY || 'OmniPosDev2026MasterKey';

    // Verify developer credential to prevent unauthorized source code downloads
    if (!devToken || devToken !== validSecret) {
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado: Se requiere autorización de desarrollador para descargar el código fuente.',
      });
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sistema-pos-multisucursal.zip"'
    );

    const archive = new ZipArchive({
      zlib: { level: 9 },
    });

    archive.on('error', (err: any) => {
      console.error('Archiver error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error generating zip: ' + err.message });
      }
    });

    archive.pipe(res);

    // Glob files, excluding sensitive data, customer records, secrets and environment configs
    archive.glob('**/*', {
      cwd: rootDir,
      ignore: [
        'node_modules/**',
        'dist/**',
        '.git/**',
        '.aistudio/**',
        'data/**',
        '.env*',
        'firebase-applet-config.json',
        '**/*.zip',
        '**/*.tar.gz',
      ],
      dot: true,
    });

    archive.finalize();
  } catch (err: any) {
    console.error('Error generating zip:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error generating zip: ' + err.message });
    }
  }
});

// Ed25519 Asymmetric Cryptographic Signing Keys (Private Key strictly kept on Server)
const ED25519_SECRET_KEY_HEX =
  process.env.DEV_LICENSE_ED25519_SECRET_KEY ||
  '50cbb06d4a2028f3c629ac174add60e0cea17976d10318569b571096f04b1b707ed10863ff7693b72c2c351ce688d2c55c0dda497a32e43b4603919921475431';

function signLicensePayloadEd25519(base64Payload: string, machineId: string): string {
  const secretKeyBytes = Uint8Array.from(Buffer.from(ED25519_SECRET_KEY_HEX, 'hex'));
  const messageStr = `${base64Payload}::${machineId.trim().toUpperCase()}`;
  const messageBytes = Uint8Array.from(Buffer.from(messageStr, 'utf-8'));
  const signatureBytes = nacl.sign.detached(messageBytes, secretKeyBytes);
  return Buffer.from(signatureBytes).toString('hex');
}

// Protected Developer License Generator Endpoint (Requires Master Developer Secret)
app.post('/api/developer/license/generate', licenseRateLimiter, (req, res) => {
  try {
    const { machineId, empresa, rif, tipo, fechaEmision, fechaVencimiento, cajasMax, sucursalesMax, devSecret } = req.body;
    const token = devSecret || (req.headers['x-admin-token'] as string);
    const validSecret = process.env.ADMIN_DEV_KEY || 'OmniPosDev2026MasterKey';

    if (!token || token !== validSecret) {
      return res.status(403).json({
        success: false,
        error: 'Acceso denegado: Se requiere la clave maestra de desarrollador para emitir licencias.',
      });
    }

    if (!machineId || !empresa) {
      return res.status(400).json({ success: false, error: 'machineId y empresa son campos requeridos.' });
    }

    const payload = {
      machineId: String(machineId).trim().toUpperCase(),
      empresa: String(empresa).trim(),
      rif: String(rif || 'J-00000000-0').trim().toUpperCase(),
      tipo: tipo || 'vitalicia',
      fechaEmision: fechaEmision || new Date().toISOString().split('T')[0],
      fechaVencimiento: fechaVencimiento || 'VITALICIA',
      cajasMax: Number(cajasMax) || 1,
      sucursalesMax: Number(sucursalesMax) || 1,
    };

    const jsonStr = JSON.stringify(payload);
    const base64Payload = Buffer.from(jsonStr, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 1. Modern Ed25519 Asymmetric Digital Signature (64-byte un-truncated signature)
    const ed25519SigHex = signLicensePayloadEd25519(base64Payload, payload.machineId);
    const activationKey = `ED2-${base64Payload}.${ed25519SigHex}`;

    // 2. Legacy signature for backwards compatibility / migration
    const legacySecret = process.env.LICENSE_MASTER_KEY || 'POS_CRYPT_SEC_KEY_VAL_2026_MULTI_BRANCH_LATAM_G82X';
    const legacyHash = crypto.createHash('sha256')
      .update(`${base64Payload}::${legacySecret}::${payload.machineId}`)
      .digest('hex');
    const legacyKey = `LIC-${base64Payload}.${legacyHash.substring(0, 16).toUpperCase()}`;

    return res.json({
      success: true,
      key: activationKey,
      legacyKey,
      payload,
      algorithm: 'Ed25519 Asymmetric Digital Signature',
    });
  } catch (err: any) {
    console.error('Error generating developer license:', err);
    return res.status(500).json({ success: false, error: 'Error interno al generar licencia.' });
  }
});

// Official Trial / Demo License Endpoint (15 days evaluation)
app.post('/api/developer/license/trial', licenseRateLimiter, (req, res) => {
  try {
    const { machineId, empresa, rif } = req.body;
    if (!machineId) {
      return res.status(400).json({ success: false, error: 'machineId es requerido para el período de prueba.' });
    }

    const now = new Date();
    const expDate = new Date();
    expDate.setDate(expDate.getDate() + 15);

    const payload = {
      machineId: String(machineId).trim().toUpperCase(),
      empresa: String(empresa || 'Negocio Demo Evaluación').trim(),
      rif: String(rif || 'J-00000000-0').trim().toUpperCase(),
      tipo: 'demo' as const,
      fechaEmision: now.toISOString().split('T')[0],
      fechaVencimiento: expDate.toISOString().split('T')[0],
      cajasMax: 2,
      sucursalesMax: 2,
    };

    const jsonStr = JSON.stringify(payload);
    const base64Payload = Buffer.from(jsonStr, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const ed25519SigHex = signLicensePayloadEd25519(base64Payload, payload.machineId);
    const activationKey = `ED2-${base64Payload}.${ed25519SigHex}`;

    return res.json({
      success: true,
      key: activationKey,
      payload,
      message: 'Licencia Demo de 15 días emitida con firma digital oficial.',
    });
  } catch (err: any) {
    console.error('Error issuing trial license:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Lazy initialization of Gemini client
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('La variable de entorno GEMINI_API_KEY no está configurada en los Secrets del servidor.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Allowed MIME types and max size for invoice documents
const ALLOWED_INVOICE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'application/pdf'];
const MAX_INVOICE_BASE64_LENGTH = 35 * 1024 * 1024; // ~25MB file size limit

// Parse invoice image or PDF using Gemini 3.8 Flash (Protected with Rate Limit, MIME & Size validation)
app.post('/api/compras/parse-invoice', invoiceRateLimiter, async (req, res) => {
  try {
    const { fileBase64, mimeType } = req.body;

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionar la imagen o archivo PDF en formato base64 y su tipo MIME.',
      });
    }

    const normalizedMime = String(mimeType).toLowerCase().trim();
    if (!ALLOWED_INVOICE_MIMES.includes(normalizedMime)) {
      return res.status(400).json({
        success: false,
        error: 'Tipo de archivo no permitido. Solo se admiten imágenes JPG, PNG, WEBP o documentos PDF.',
      });
    }

    // Clean base64 string if it contains data URI prefix
    const cleanBase64 = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64;

    if (cleanBase64.length > MAX_INVOICE_BASE64_LENGTH) {
      return res.status(413).json({
        success: false,
        error: 'El archivo excede el tamaño máximo permitido de 25MB.',
      });
    }

    const ai = getGenAI();

    const filePart = {
      inlineData: {
        data: cleanBase64,
        mimeType: normalizedMime,
      },
    };

    const promptText = `
Eres un asistente contable y administrativo de alta precisión especializado en facturas comerciales y notas de entrega de proveedores (incluyendo facturación venezolana con IVA 16%, exentos (E), gravados (G), RIF, número de control, y códigos de barra).

Analiza detalladamente este documento (imagen o archivo PDF de factura de proveedor) y extrae de forma estructurada:
1. Nombre o razón social del proveedor emisor (proveedorNombre).
2. RIF o identificación fiscal del proveedor (proveedorRif), ej: J-12345678-0 o V-12345678.
3. Número de factura (numeroFactura), correlativo o folio (ej: FAC-00984, 0001234).
4. Número de control (numeroControl) si está presente.
5. Fecha de emisión (fechaFactura) en formato YYYY-MM-DD. Si no tiene año, asume el año actual.
6. Condición de pago (condicionPago): 'contado' o 'credito'.
7. Fecha de vencimiento (fechaVencimiento) en formato YYYY-MM-DD si la factura es a crédito o tiene fecha de vencimiento explícita (ej: "Vence:", "Fecha Vcto:", "Vencimiento:"). Si no tiene fecha explícita pero indica días de crédito (ej: "Crédito 7 días", "Plazo 15 días"), calcula la fecha de vencimiento sumando esos días a fechaFactura.
8. Días de crédito (diasCredito): Número entero de días de crédito concedidos por el proveedor (ej: 7, 14, 15, 21, 30). Si la factura tiene fecha de emisión y fecha de vencimiento, calcula exactamente la diferencia en días entre ambas (por ejemplo: si emite el día 13 y vence el día 20, son exactamente 7 días).
9. Lista completa de renglones o productos facturados (items):
   - codigo_barras: Código de barra numérico, SKU o código de producto impreso. Si no tiene, déjalo como cadena vacía "".
   - descripcion: Nombre completo, marca o descripción del producto.
   - unidad_medida: Presentación ('UND' para unidades/piezas, 'KG' para kilogramos/peso, 'L' para litros, 'PQ' para paquetes/bultos).
   - cantidad: Cantidad adquirida numérica (soporta decimales ej: 0.500, 1.250).
   - precio_unitario: Costo unitario antes o con descuento (en USD o moneda base).
   - subtotal: Subtotal del renglón (cantidad * precio_unitario).
   - exento: booleano (true si el producto está marcado como exento de IVA o tasa 0%, false si está gravado con IVA 16%).
10. Totales de la factura:
   - subtotalNeto: suma de subtotales de todos los renglones.
   - baseImponible: monto sujeto al 16% de IVA.
   - montoExento: monto total exento de IVA (tasa 0%).
   - totalIva: monto total de impuesto IVA (16%).
   - totalFactura: monto total final a pagar de la factura.

Asegúrate de que los cálculos numéricos sean consistentes. Extrae todos los renglones posibles con fidelidad.
`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          filePart,
          { text: promptText },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            proveedorNombre: {
              type: Type.STRING,
              description: 'Nombre o razón social del proveedor emisor',
            },
            proveedorRif: {
              type: Type.STRING,
              description: 'RIF o número fiscal del proveedor',
            },
            numeroFactura: {
              type: Type.STRING,
              description: 'Número de factura o serie',
            },
            numeroControl: {
              type: Type.STRING,
              description: 'Número de control fiscal si existe',
            },
            fechaFactura: {
              type: Type.STRING,
              description: 'Fecha de emisión en formato YYYY-MM-DD',
            },
            fechaVencimiento: {
              type: Type.STRING,
              description: 'Fecha de vencimiento en formato YYYY-MM-DD',
            },
            diasCredito: {
              type: Type.INTEGER,
              description: 'Días de crédito entre emisión y vencimiento (ej: 7, 15, 30)',
            },
            condicionPago: {
              type: Type.STRING,
              description: 'Condición de pago: contado o credito',
            },
            items: {
              type: Type.ARRAY,
              description: 'Renglones o productos de la factura',
              items: {
                type: Type.OBJECT,
                properties: {
                  codigo_barras: {
                    type: Type.STRING,
                    description: 'Código de barras o SKU',
                  },
                  descripcion: {
                    type: Type.STRING,
                    description: 'Descripción detallada del producto',
                  },
                  unidad_medida: {
                    type: Type.STRING,
                    description: 'Unidad de medida: UND, KG, L, PQ',
                  },
                  cantidad: {
                    type: Type.NUMBER,
                    description: 'Cantidad numérica facturada',
                  },
                  precio_unitario: {
                    type: Type.NUMBER,
                    description: 'Costo unitario del producto',
                  },
                  subtotal: {
                    type: Type.NUMBER,
                    description: 'Subtotal del producto',
                  },
                  exento: {
                    type: Type.BOOLEAN,
                    description: 'true si es exento de IVA, false si es gravado con IVA 16%',
                  },
                },
                required: ['descripcion', 'cantidad', 'precio_unitario', 'subtotal', 'exento'],
              },
            },
            subtotalNeto: {
              type: Type.NUMBER,
              description: 'Subtotal neto de la factura',
            },
            baseImponible: {
              type: Type.NUMBER,
              description: 'Base imponible para IVA 16%',
            },
            montoExento: {
              type: Type.NUMBER,
              description: 'Monto total exento de IVA',
            },
            totalIva: {
              type: Type.NUMBER,
              description: 'Total monto de IVA 16%',
            },
            totalFactura: {
              type: Type.NUMBER,
              description: 'Total final a pagar de la factura',
            },
          },
          required: ['proveedorNombre', 'numeroFactura', 'items', 'totalFactura'],
        },
      },
    });

    const rawJson = response.text;
    if (!rawJson) {
      throw new Error('El modelo no devolvió una respuesta de texto con el formato esperado.');
    }

    const parsedData = JSON.parse(rawJson.trim());

    // Validate and compute credit days and expiration dates consistently
    if (parsedData.condicionPago === 'credito' || parsedData.fechaVencimiento || parsedData.diasCredito) {
      if (!parsedData.condicionPago) parsedData.condicionPago = 'credito';

      const emision = parsedData.fechaFactura ? new Date(parsedData.fechaFactura) : new Date();
      if (parsedData.fechaVencimiento && parsedData.fechaFactura) {
        const vcto = new Date(parsedData.fechaVencimiento);
        const diffDays = Math.round((vcto.getTime() - emision.getTime()) / (1000 * 3600 * 24));
        if (diffDays > 0) {
          parsedData.diasCredito = diffDays;
        }
      } else if (parsedData.diasCredito && parsedData.diasCredito > 0 && parsedData.fechaFactura) {
        const vcto = new Date(emision.getTime() + parsedData.diasCredito * 24 * 3600 * 1000);
        parsedData.fechaVencimiento = vcto.toISOString().split('T')[0];
      } else if (parsedData.condicionPago === 'credito') {
        parsedData.diasCredito = parsedData.diasCredito || 7;
        const vcto = new Date(emision.getTime() + parsedData.diasCredito * 24 * 3600 * 1000);
        parsedData.fechaVencimiento = vcto.toISOString().split('T')[0];
      }
    }

    return res.json({
      success: true,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('[Gemini Invoice Parse Error]:', error?.message || error);
    return res.status(500).json({
      success: false,
      error: 'No se pudo procesar la factura con el asistente de IA. Verifique que el documento sea legible e intente nuevamente.',
    });
  }
});

// JSON 404 handler for undefined API routes (ensures programmatic clients receive JSON, while browsers redirect to /)
app.all(['/api/*', '/api'], (req, res) => {
  const acceptHeader = String(req.headers.accept || '');
  const isBrowser = (req.method === 'GET' || req.method === 'HEAD') && acceptHeader.includes('text/html') && !req.xhr && !req.headers['x-requested-with'];
  if (isBrowser) {
    return res.redirect('/');
  }
  res.status(404).json({
    success: false,
    error: `Ruta de API no encontrada: ${req.method} ${req.path}`,
  });
});

// Vite middleware setup
async function startServer() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.argv.some(arg => arg.includes('server.cjs')) ||
    (typeof __filename !== 'undefined' && __filename.endsWith('server.cjs'));

  if (!isProduction) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: {
          ignored: ['**/data/**', '**/server_db.json'],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT} [Modo: ${isProduction ? 'Producción' : 'Desarrollo'}]`);
  });
}

startServer();

