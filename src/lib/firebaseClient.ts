import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  collection,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
  getDocs,
  deleteDoc,
  limit,
  runTransaction,
} from 'firebase/firestore';
import firebaseConfigData from '../../firebase-applet-config.json';
import {
  Producto,
  PedidoOnline,
  EmpresaConfig,
  TiendaConfig,
  Sucursal,
  InventarioItem,
  Venta,
  Compra,
  CuentaPorCobrar,
  CuentaPorPagar,
  RegistroAuditoria,
} from '../types';

export const firebaseConfig = {
  projectId: firebaseConfigData.projectId,
  appId: firebaseConfigData.appId,
  apiKey: firebaseConfigData.apiKey,
  authDomain: firebaseConfigData.authDomain,
  firestoreDatabaseId: firebaseConfigData.firestoreDatabaseId || '(default)',
  storageBucket: firebaseConfigData.storageBucket,
  messagingSenderId: firebaseConfigData.messagingSenderId,
};

// Initialize Firebase App singleton
export const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Initialize Firestore targeting the provisioned database ID
export const db = getFirestore(
  firebaseApp,
  firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
    ? firebaseConfig.firestoreDatabaseId
    : undefined
);

/**
 * Validates connection to Firestore server directly
 */
export async function testFirestoreConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const testDocRef = doc(db, 'test', 'connection');
    await setDoc(testDocRef, { ping: Date.now(), timestamp: new Date().toISOString() }, { merge: true });
    const snap = await getDocFromServer(testDocRef);
    if (snap.exists()) {
      return {
        success: true,
        message: '¡Conectado exitosamente con Firebase Firestore (Google Cloud)!',
      };
    }
    return {
      success: true,
      message: 'Conexión verificada con el clúster de Firestore.',
    };
  } catch (error: any) {
    console.error('Firebase test connection error:', error);
    if (error instanceof Error && error.message.includes('the client is offline')) {
      return {
        success: false,
        message: 'El dispositivo no tiene acceso a internet o la base de datos está desconectada.',
      };
    }
    return {
      success: false,
      message: `Error al conectar con Firestore: ${error?.message || error}`,
    };
  }
}

/**
 * Real-time listener for incoming Web Orders (pedidos_online)
 */
export function subscribeToPedidosOnline(
  onOrdersUpdated: (orders: PedidoOnline[]) => void,
  onError?: (err: Error) => void
) {
  try {
    const q = query(collection(db, 'pedidos_online'), orderBy('fecha', 'desc'), limit(150));
    return onSnapshot(
      q,
      (snapshot) => {
        const orders: PedidoOnline[] = [];
        snapshot.forEach((d) => {
          orders.push(d.data() as PedidoOnline);
        });
        onOrdersUpdated(orders);
      },
      (err) => {
        console.warn('Firestore pedidos_online subscription notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (e: any) {
    console.warn('Error starting pedidos_online listener:', e);
    return () => {};
  }
}

/**
 * Saves a new online web order into Firestore
 */
export async function savePedidoOnlineToFirestore(pedido: PedidoOnline): Promise<boolean> {
  try {
    const docRef = doc(db, 'pedidos_online', pedido.id);
    await setDoc(docRef, pedido, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving pedido_online to Firestore:', error);
    return false;
  }
}

/**
 * Updates status or details of a web order in Firestore
 */
export async function updatePedidoOnlineInFirestore(
  pedidoId: string,
  updates: Partial<PedidoOnline>
): Promise<boolean> {
  try {
    const docRef = doc(db, 'pedidos_online', pedidoId);
    await setDoc(docRef, updates, { merge: true });
    return true;
  } catch (error) {
    console.error('Error updating pedido_online in Firestore:', error);
    return false;
  }
}

/**
 * Real-time listener for company configuration and daily exchange rate
 */
export function subscribeToEmpresaConfig(
  onConfigUpdated: (config: EmpresaConfig) => void,
  onError?: (err: Error) => void
) {
  try {
    const docRef = doc(db, 'empresa_config', 'main');
    return onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          onConfigUpdated(snap.data() as EmpresaConfig);
        }
      },
      (err) => {
        console.warn('Firestore empresa_config notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (e: any) {
    console.warn('Error subscribing to empresa_config:', e);
    return () => {};
  }
}

/**
 * Saves company configuration and exchange rate to Firestore
 */
export async function saveEmpresaConfigToFirestore(config: EmpresaConfig): Promise<boolean> {
  try {
    const cleanConfig: Record<string, any> = {
      nombreEmpresa: config.nombreEmpresa || '',
      rif: config.rif || '',
      direccionFiscal: config.direccionFiscal || '',
      telefono: config.telefono || '',
      logoUrl: config.logoUrl || '',
      tasaCambio: Number(config.tasaCambio) || 0,
      fechaTasa: config.fechaTasa || new Date().toLocaleDateString('es-VE'),
      ultimaActualizacionTasa: config.ultimaActualizacionTasa || new Date().toISOString(),
      nombreTienda1: config.nombreTienda1 || 'Tienda 1',
      nombreTienda2: config.nombreTienda2 || 'Tienda 2',
      nombreOficina: config.nombreOficina || 'Oficina Central / Almacén',
    };
    if ((config as any).piePaginaTicket !== undefined) {
      cleanConfig.piePaginaTicket = (config as any).piePaginaTicket;
    }
    await setDoc(doc(db, 'empresa_config', 'main'), cleanConfig, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving empresa_config to Firestore:', error);
    return false;
  }
}

/**
 * Fetch company configuration directly once from Firestore
 */
export async function getEmpresaConfigFromFirestore(): Promise<EmpresaConfig | null> {
  try {
    const empSnap = await getDoc(doc(db, 'empresa_config', 'main'));
    if (empSnap.exists()) {
      return empSnap.data() as EmpresaConfig;
    }
  } catch (e) {
    console.warn('Could not fetch empresa_config directly:', e);
  }
  return null;
}

/**
 * Real-time listener for digital store settings
 */
export function subscribeToTiendaConfig(
  onConfigUpdated: (config: TiendaConfig) => void,
  onError?: (err: Error) => void
) {
  try {
    const docRef = doc(db, 'tienda_config', 'main');
    return onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          onConfigUpdated(snap.data() as TiendaConfig);
        }
      },
      (err) => {
        console.warn('Firestore tienda_config notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (e: any) {
    console.warn('Error subscribing to tienda_config:', e);
    return () => {};
  }
}

/**
 * Saves digital store configuration to Firestore
 */
export async function saveTiendaConfigToFirestore(config: TiendaConfig): Promise<boolean> {
  try {
    await setDoc(doc(db, 'tienda_config', 'main'), config, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving tienda_config to Firestore:', error);
    return false;
  }
}

/**
 * Real-time listener for products catalog
 */
export function subscribeToProductos(
  onProductosUpdated: (products: Producto[]) => void,
  onError?: (err: Error) => void
) {
  try {
    const colRef = collection(db, 'productos');
    return onSnapshot(
      colRef,
      (snapshot) => {
        if (!snapshot.empty) {
          const prods: Producto[] = [];
          snapshot.forEach((d) => {
            prods.push(d.data() as Producto);
          });
          onProductosUpdated(prods);
        }
      },
      (err) => {
        console.warn('Firestore productos notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (e: any) {
    console.warn('Error subscribing to productos:', e);
    return () => {};
  }
}

/**
 * Save single product to Firestore
 */
export async function saveProductToFirestore(prod: Producto): Promise<boolean> {
  try {
    const cleanProd: Record<string, any> = {
      id: prod.id,
      nombre: prod.nombre || '',
      precio: Number(prod.precio) || 0,
      codigo_barras: prod.codigo_barras || '',
      costo: prod.costo !== undefined ? Number(prod.costo) : 0,
      unidad_medida: prod.unidad_medida || 'UND',
      exento_iva: Boolean(prod.exento_iva),
      categoria: prod.categoria || 'General',
      descripcion: prod.descripcion || '',
      imagen: prod.imagen || '',
      destacadoTienda: prod.destacadoTienda !== undefined ? Boolean(prod.destacadoTienda) : true,
    };
    await setDoc(doc(db, 'productos', String(prod.id)), cleanProd, { merge: true });
    return true;
  } catch (err) {
    console.error('Error saving product to Firestore:', err);
    return false;
  }
}

/**
 * Delete product document from Firestore
 */
export async function deleteProductFromFirestore(prodId: number): Promise<boolean> {
  try {
    await deleteDoc(doc(db, 'productos', String(prodId)));
    return true;
  } catch (err) {
    console.error('Error deleting product from Firestore:', err);
    return false;
  }
}

/**
 * Save inventario stock to Firestore with Branch Isolation (Separación por Sucursal)
 * Saves isolated documents per branch (`inventario/sucursal_${id}`) to prevent
 * cross-branch overwrite and document size limit issues.
 */
export async function saveInventarioToFirestore(
  inventario: InventarioItem[],
  targetSucursalId?: number
): Promise<boolean> {
  try {
    // Group inventory by branch (sucursal)
    const bySucursal = new Map<number, InventarioItem[]>();
    for (const item of inventario) {
      const list = bySucursal.get(item.sucursal_id) || [];
      list.push(item);
      bySucursal.set(item.sucursal_id, list);
    }

    // Save each branch's stock in its own isolated document
    const batch = writeBatch(db);
    const sucursalesToSave = targetSucursalId ? [targetSucursalId] : Array.from(bySucursal.keys());

    for (const sId of sucursalesToSave) {
      const branchItems = bySucursal.get(sId) || [];
      const branchDocRef = doc(db, 'inventario', `sucursal_${sId}`);
      batch.set(
        branchDocRef,
        {
          sucursalId: sId,
          items: branchItems,
          totalArticulos: branchItems.length,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    }

    // Keep legacy main doc updated for backwards compatibility
    batch.set(
      doc(db, 'inventario', 'main'),
      {
        items: inventario,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    await batch.commit();
    return true;
  } catch (err) {
    console.error('Error saving inventario to Firestore:', err);
    return false;
  }
}

/**
 * Fetch consolidated inventario from Firestore with multi-branch support
 */
export async function fetchInventarioFromFirestore(): Promise<InventarioItem[] | null> {
  try {
    const invColSnap = await getDocs(collection(db, 'inventario'));
    if (!invColSnap.empty) {
      const consolidatedMap = new Map<string, InventarioItem>();
      let foundBranchDocs = false;

      invColSnap.forEach((d) => {
        if (d.id.startsWith('sucursal_') && Array.isArray(d.data().items)) {
          foundBranchDocs = true;
          (d.data().items as InventarioItem[]).forEach((item) => {
            consolidatedMap.set(`${item.sucursal_id}_${item.producto_id}`, item);
          });
        }
      });

      if (foundBranchDocs && consolidatedMap.size > 0) {
        return Array.from(consolidatedMap.values());
      }

      // Fallback to main document
      const mainDoc = invColSnap.docs.find((d) => d.id === 'main');
      if (mainDoc && Array.isArray(mainDoc.data().items)) {
        return mainDoc.data().items as InventarioItem[];
      }
    }
  } catch (err) {
    console.warn('Error fetching inventario from Firestore:', err);
  }
  return null;
}

/**
 * Synchronize full local product catalog and stock to Firestore
 * Safely upserts products and sucursales without destructive deletes
 * that could eliminate products registered in other branches.
 */
export async function syncAllToFirestore({
  productos,
  empresaConfig,
  tiendaConfig,
  sucursales,
  inventario,
}: {
  productos: Producto[];
  empresaConfig: EmpresaConfig;
  tiendaConfig: TiendaConfig;
  sucursales: Sucursal[];
  inventario: InventarioItem[];
}): Promise<{ success: boolean; count: number; deletedCount: number; error?: string }> {
  try {
    // 1. Sync Empresa & Tienda config and branch-isolated inventory
    await saveEmpresaConfigToFirestore(empresaConfig);
    await saveTiendaConfigToFirestore(tiendaConfig);
    await saveInventarioToFirestore(inventario);

    // 2. Safe chunked batch upsert of local products (max 400 operations per batch to comply with Firestore's 500-write limit)
    const BATCH_LIMIT = 400;
    let count = 0;

    for (let i = 0; i < productos.length; i += BATCH_LIMIT) {
      const slice = productos.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);

      for (const prod of slice) {
        const prodRef = doc(db, 'productos', String(prod.id));
        const cleanProd: Record<string, any> = {
          id: prod.id,
          nombre: prod.nombre || '',
          precio: Number(prod.precio) || 0,
          codigo_barras: prod.codigo_barras || '',
          costo: prod.costo !== undefined ? Number(prod.costo) : 0,
          unidad_medida: prod.unidad_medida || 'UND',
          exento_iva: Boolean(prod.exento_iva),
          categoria: prod.categoria || 'General',
          descripcion: prod.descripcion || '',
          imagen: prod.imagen || '',
          destacadoTienda: prod.destacadoTienda !== undefined ? Boolean(prod.destacadoTienda) : true,
        };
        batch.set(prodRef, cleanProd, { merge: true });
        count++;
      }

      await batch.commit();
    }

    // 3. Batch write sucursales in dedicated batch
    if (sucursales.length > 0) {
      const sucBatch = writeBatch(db);
      for (const suc of sucursales) {
        const sucRef = doc(db, 'sucursales', String(suc.id));
        sucBatch.set(sucRef, suc, { merge: true });
      }
      await sucBatch.commit();
    }

    return { success: true, count, deletedCount: 0 };
  } catch (err: any) {
    console.error('Error syncing all to Firestore:', err);
    return { success: false, count: 0, deletedCount: 0, error: err?.message || String(err) };
  }
}

/**
 * Load initial data from Firestore if present
 */
export async function fetchAllFromFirestore(): Promise<{
  productos?: Producto[];
  inventario?: InventarioItem[];
  empresaConfig?: EmpresaConfig;
  tiendaConfig?: TiendaConfig;
  pedidos?: PedidoOnline[];
} | null> {
  try {
    const result: any = {};

    // 1. Fetch empresa config
    const empSnap = await getDoc(doc(db, 'empresa_config', 'main'));
    if (empSnap.exists()) {
      result.empresaConfig = empSnap.data() as EmpresaConfig;
    }

    // 2. Fetch tienda config
    const tiendaSnap = await getDoc(doc(db, 'tienda_config', 'main'));
    if (tiendaSnap.exists()) {
      result.tiendaConfig = tiendaSnap.data() as TiendaConfig;
    }

    // 3. Fetch inventario
    const invSnap = await getDoc(doc(db, 'inventario', 'main'));
    if (invSnap.exists() && Array.isArray(invSnap.data().items)) {
      result.inventario = invSnap.data().items;
    }

    // 4. Fetch productos
    const prodSnap = await getDocs(collection(db, 'productos'));
    if (!prodSnap.empty) {
      const prods: Producto[] = [];
      prodSnap.forEach((d) => prods.push(d.data() as Producto));
      result.productos = prods;
    }

    // 5. Fetch pedidos_online
    const pedSnap = await getDocs(collection(db, 'pedidos_online'));
    if (!pedSnap.empty) {
      const orders: PedidoOnline[] = [];
      pedSnap.forEach((d) => orders.push(d.data() as PedidoOnline));
      result.pedidos = orders;
    }

    return result;
  } catch (error) {
    console.error('Error fetching all from Firestore:', error);
    return null;
  }
}

// ----------------------------------------------------------------------
// CONCURRENCY & TRANSACTIONAL INTEGRITY (FASE 4 AUDITORÍA)
// ----------------------------------------------------------------------

export interface TransaccionVentaInput {
  venta: Venta;
  sucursalId: number;
  items: { producto: Producto; cantidad: number }[];
}

export interface TransaccionVentaResult {
  success: boolean;
  ventaDocId?: string;
  error?: string;
  stockFaltante?: { productoId: number; nombre: string; stockDisponible: number; requerido: number }[];
  isOffline?: boolean;
}

/**
 * Transacción Atómica de Venta:
 * Bloquea y verifica el stock disponible en la sucursal antes de vender.
 * Evita la sobreventa concurrente de dos cajas vendiendo las últimas unidades.
 * Si no hay stock suficiente, aborta la transacción y devuelve el detalle exacto.
 */
export async function registrarVentaTransaccional(
  input: TransaccionVentaInput
): Promise<TransaccionVentaResult> {
  const { venta, sucursalId, items } = input;
  const branchDocRef = doc(db, 'inventario', `sucursal_${sucursalId}`);
  const ventaDocId = `vta_${sucursalId}_${venta.id || Date.now()}`;
  const ventaDocRef = doc(db, 'ventas', ventaDocId);

  try {
    const result = await runTransaction(db, async (transaction) => {
      // 1. Leer el inventario actual de la sucursal
      const branchSnap = await transaction.get(branchDocRef);
      let branchItems: InventarioItem[] = [];

      if (branchSnap.exists() && Array.isArray(branchSnap.data().items)) {
        branchItems = branchSnap.data().items as InventarioItem[];
      }

      // 2. Validar existencias concurrentes para cada producto
      const faltantes: { productoId: number; nombre: string; stockDisponible: number; requerido: number }[] = [];

      for (const item of items) {
        const invItem = branchItems.find((i) => i.producto_id === item.producto.id);
        const currentStock = invItem ? invItem.stock : 0;
        if (currentStock < item.cantidad) {
          faltantes.push({
            productoId: item.producto.id,
            nombre: item.producto.nombre,
            stockDisponible: currentStock,
            requerido: item.cantidad,
          });
        }
      }

      if (faltantes.length > 0) {
        throw new Error(`STOCK_INSUFICIENTE:${JSON.stringify(faltantes)}`);
      }

      // 3. Descontar el inventario de manera atómica
      const updatedItems = branchItems.map((invItem) => {
        const soldItem = items.find((i) => i.producto.id === invItem.producto_id);
        if (soldItem) {
          return {
            ...invItem,
            stock: Math.max(0, +(invItem.stock - soldItem.cantidad).toFixed(3)),
          };
        }
        return invItem;
      });

      // 4. Preparar el documento de venta inmutable y limpio
      const numeroFactura =
        (venta as any).numeroFactura ||
        `FAC-${String(sucursalId).padStart(2, '0')}-${String(venta.id).padStart(6, '0')}`;

      const cleanVenta: Record<string, any> = {
        ...venta,
        numeroFactura,
        id: venta.id,
        sucursal_id: sucursalId,
        fecha: venta.fecha || new Date().toISOString(),
        total: Number(venta.total) || 0,
      };

      // 5. Registrar venta y actualizar inventario en el mismo batch atómico
      transaction.set(ventaDocRef, cleanVenta);
      transaction.set(
        branchDocRef,
        {
          sucursalId,
          items: updatedItems,
          totalArticulos: updatedItems.length,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // 6. Registrar bitácora de auditoría atómica
      const auditDocId = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const auditRef = doc(db, 'auditoria', auditDocId);
      transaction.set(auditRef, {
        id: auditDocId,
        accion: 'VENTA',
        modulo: 'POS / Ventas',
        descripcion: `Venta POS #${cleanVenta.numeroFactura} registrada por $${cleanVenta.total.toFixed(2)}`,
        usuario: venta.usuario_nombre || 'Cajero',
        timestamp: new Date().toISOString(),
      });

      return {
        success: true,
        ventaDocId,
      };
    });

    return result;
  } catch (err: any) {
    if (err.message && err.message.startsWith('STOCK_INSUFICIENTE:')) {
      const faltantes = JSON.parse(err.message.replace('STOCK_INSUFICIENTE:', ''));
      return {
        success: false,
        error: 'No hay suficiente inventario disponible para completar la venta.',
        stockFaltante: faltantes,
      };
    }

    console.warn('Transacción de venta Firestore notice/fallback:', err);
    return {
      success: false,
      error: err.message || 'Error en transacción de venta',
      isOffline: err.message?.includes('offline') || err.code === 'unavailable',
    };
  }
}

/**
 * Transferencia de Stock Atómica entre Sucursales:
 * Deduce en origen y añade en destino en una sola transacción sin pérdidas.
 */
export async function transferirStockTransaccional({
  origenId,
  destinoId,
  productoId,
  productoNombre,
  cantidad,
  usuarioNombre,
}: {
  origenId: number;
  destinoId: number;
  productoId: number;
  productoNombre: string;
  cantidad: number;
  usuarioNombre?: string;
}): Promise<{ success: boolean; error?: string }> {
  const origDocRef = doc(db, 'inventario', `sucursal_${origenId}`);
  const destDocRef = doc(db, 'inventario', `sucursal_${destinoId}`);

  try {
    await runTransaction(db, async (transaction) => {
      const origSnap = await transaction.get(origDocRef);
      const destSnap = await transaction.get(destDocRef);

      const origItems: InventarioItem[] =
        origSnap.exists() && Array.isArray(origSnap.data().items) ? origSnap.data().items : [];
      const destItems: InventarioItem[] =
        destSnap.exists() && Array.isArray(destSnap.data().items) ? destSnap.data().items : [];

      const origItem = origItems.find((i) => i.producto_id === productoId);
      const currentStock = origItem ? origItem.stock : 0;

      if (currentStock < cantidad) {
        throw new Error(
          `Stock insuficiente en sucursal de origen: disponible ${currentStock}, requerido ${cantidad}`
        );
      }

      // Descontar en origen
      const nextOrigItems = origItems.map((item) => {
        if (item.producto_id === productoId) {
          return { ...item, stock: +(item.stock - cantidad).toFixed(3) };
        }
        return item;
      });

      // Añadir en destino
      let nextDestItems: InventarioItem[] = [];
      const destItemExists = destItems.some((i) => i.producto_id === productoId);

      if (destItemExists) {
        nextDestItems = destItems.map((item) => {
          if (item.producto_id === productoId) {
            return { ...item, stock: +(item.stock + cantidad).toFixed(3) };
          }
          return item;
        });
      } else {
        nextDestItems = [
          ...destItems,
          {
            id: Date.now(),
            sucursal_id: destinoId,
            producto_id: productoId,
            stock: cantidad,
          },
        ];
      }

      transaction.set(origDocRef, { items: nextOrigItems, updatedAt: new Date().toISOString() }, { merge: true });
      transaction.set(destDocRef, { items: nextDestItems, updatedAt: new Date().toISOString() }, { merge: true });

      // Registro de auditoría
      const auditDocId = `aud_tr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      transaction.set(doc(db, 'auditoria', auditDocId), {
        id: auditDocId,
        accion: 'TRASPASO',
        modulo: 'Inventario',
        descripcion: `Transferencia atómica de ${cantidad} und de "${productoNombre}" de sucursal #${origenId} a #${destinoId}`,
        usuario: usuarioNombre || 'Supervisor',
        timestamp: new Date().toISOString(),
      });
    });

    return { success: true };
  } catch (err: any) {
    console.error('Error en transferencia atómica:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Registro Atómico de Compras e Incremento de Stock:
 * Guarda la factura de compra, suma existencias y genera la cuenta por pagar (CxP) si fue a crédito.
 */
export async function registrarCompraTransaccional(
  compra: Compra,
  usuarioNombre?: string
): Promise<{ success: boolean; error?: string }> {
  const branchDocRef = doc(db, 'inventario', `sucursal_${compra.sucursalId}`);
  const compraDocRef = doc(db, 'compras', `cmp_${compra.id}`);

  try {
    await runTransaction(db, async (transaction) => {
      const branchSnap = await transaction.get(branchDocRef);
      let branchItems: InventarioItem[] = [];
      if (branchSnap.exists() && Array.isArray(branchSnap.data().items)) {
        branchItems = branchSnap.data().items;
      }

      // Incrementar stock para cada renglón comprado
      let nextItems = [...branchItems];
      for (const detalle of compra.detalles) {
        const index = nextItems.findIndex((i) => i.producto_id === detalle.productoId);
        if (index >= 0) {
          nextItems[index] = {
            ...nextItems[index],
            stock: +(nextItems[index].stock + detalle.cantidad).toFixed(3),
          };
        } else {
          nextItems.push({
            id: Date.now() + Math.floor(Math.random() * 1000),
            sucursal_id: compra.sucursalId,
            producto_id: detalle.productoId,
            stock: detalle.cantidad,
          });
        }
      }

      // Guardar compra
      transaction.set(compraDocRef, {
        ...compra,
        fecha: compra.fecha || new Date().toISOString(),
        total: Number(compra.total) || 0,
        numeroFactura: compra.numeroFactura || `FAC-COMP-${compra.id}`,
      });

      // Si es a crédito, registrar en cuentas por pagar
      if (compra.condicionPago === 'credito') {
        const cxpDocRef = doc(db, 'cuentas_por_pagar', `cxp_cmp_${compra.id}`);
        transaction.set(cxpDocRef, {
          id: compra.id,
          proveedorId: compra.proveedorId,
          proveedorNombre: compra.proveedorNombre,
          facturaNumero: compra.numeroFactura || `FAC-COMP-${compra.id}`,
          concepto: `Compra a crédito de mercancía (Factura #${compra.numeroFactura || compra.id})`,
          fechaEmision: compra.fecha || new Date().toISOString(),
          fechaVencimiento: compra.fechaVencimiento || new Date(Date.now() + 15 * 86400000).toISOString(),
          montoTotal: compra.total,
          saldoRestante: compra.total,
          estado: 'pendiente',
          pagos: [],
        });
      }

      // Actualizar inventario
      transaction.set(
        branchDocRef,
        {
          items: nextItems,
          totalArticulos: nextItems.length,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Bitácora
      const auditDocId = `aud_cmp_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      transaction.set(doc(db, 'auditoria', auditDocId), {
        id: auditDocId,
        accion: 'COMPRA',
        modulo: 'Compras',
        descripcion: `Compra #${compra.numeroFactura || compra.id} de $${compra.total.toFixed(2)} a ${compra.proveedorNombre} (${compra.condicionPago || 'contado'})`,
        usuario: usuarioNombre || 'Administrador',
        timestamp: new Date().toISOString(),
      });
    });

    return { success: true };
  } catch (err: any) {
    console.error('Error en compra transaccional:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Registro Atómico de Abono en Cuentas por Cobrar (CxC):
 * Protege contra pagos duplicados o que excedan el saldo pendiente.
 */
export async function registrarAbonoCxcTransaccional({
  cxcId,
  monto,
  metodoPago,
  referencia,
  usuarioNombre,
}: {
  cxcId: number;
  monto: number;
  metodoPago: string;
  referencia?: string;
  usuarioNombre?: string;
}): Promise<{ success: boolean; nuevoSaldo?: number; error?: string }> {
  const cxcDocRef = doc(db, 'cuentas_por_cobrar', `cxc_${cxcId}`);

  try {
    const res = await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(cxcDocRef);
      if (!snap.exists()) {
        return { success: false, error: 'Cuenta por cobrar no encontrada en Firestore' };
      }

      const data = snap.data();
      const saldoActual = Number(data.saldoRestante) || 0;

      if (monto <= 0 || monto > saldoActual + 0.01) {
        throw new Error(
          `Monto inválido. El abono ($${monto.toFixed(2)}) no puede exceder el saldo restante ($${saldoActual.toFixed(2)})`
        );
      }

      const nuevoSaldo = Math.max(0, +(saldoActual - monto).toFixed(2));
      const nuevoEstado = nuevoSaldo === 0 ? 'pagada' : 'parcial';
      const pagosAnteriores = Array.isArray(data.abonos) ? data.abonos : [];

      const nuevoAbono = {
        id: pagosAnteriores.length + 1,
        fecha: new Date().toISOString(),
        monto,
        metodoPago,
        referencia: referencia || '',
        usuarioNombre: usuarioNombre || 'Cajero',
      };

      transaction.update(cxcDocRef, {
        saldoRestante: nuevoSaldo,
        estado: nuevoEstado,
        abonos: [...pagosAnteriores, nuevoAbono],
        updatedAt: new Date().toISOString(),
      });

      return { success: true, nuevoSaldo };
    });

    return res;
  } catch (err: any) {
    console.error('Error en abono CxC transaccional:', err);
    return { success: false, error: err.message };
  }
}

// ----------------------------------------------------------------------
// AUDIT LOG PERSISTENCE & REAL-TIME REPLICATION (FASE 5)
// ----------------------------------------------------------------------

/**
 * Persists an audit entry directly to Firestore.
 * Conforms to the immutable firestore.rules security blueprint.
 */
export async function saveAuditoriaLogToFirestore(entry: RegistroAuditoria): Promise<boolean> {
  try {
    const logDocId = entry.id.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const docRef = doc(db, 'auditoria', logDocId);

    const cleanEntry: Record<string, any> = {
      id: logDocId,
      accion: entry.tipo_accion || 'REGISTRO',
      tipo_accion: entry.tipo_accion || 'REGISTRO',
      modulo: entry.modulo || 'Sistema',
      descripcion: entry.descripcion || '',
      detalles: entry.detalles || '',
      usuario: entry.usuario_nombre || 'Sistema',
      usuario_id: entry.usuario_id ?? null,
      usuario_username: entry.usuario_username || '',
      usuario_rol: entry.usuario_rol || '',
      sucursal_id: entry.sucursal_id ?? null,
      sucursal_nombre: entry.sucursal_nombre || '',
      fecha: entry.fecha || new Date().toLocaleDateString('es-VE'),
      hora: entry.hora || new Date().toLocaleTimeString('es-VE'),
      timestamp: entry.timestamp || new Date().toISOString(),
    };

    await setDoc(docRef, cleanEntry);
    return true;
  } catch (err) {
    console.warn('Notice saving audit log to Firestore:', err);
    return false;
  }
}

/**
 * Real-time subscription to immutable audit logs from Firestore
 */
export function subscribeToAuditoriaLogs(
  onLogsUpdated: (logs: RegistroAuditoria[]) => void,
  onError?: (err: Error) => void
) {
  try {
    const q = query(collection(db, 'auditoria'), orderBy('timestamp', 'desc'), limit(250));
    return onSnapshot(
      q,
      (snapshot) => {
        if (!snapshot.empty) {
          const logs: RegistroAuditoria[] = [];
          snapshot.forEach((d) => {
            const data = d.data();
            logs.push({
              id: d.id,
              fecha: data.fecha || '',
              hora: data.hora || '',
              timestamp: data.timestamp || '',
              usuario_id: data.usuario_id,
              usuario_nombre: data.usuario || data.usuario_nombre || 'Operador',
              usuario_username: data.usuario_username,
              usuario_rol: data.usuario_rol,
              usuario_cargo: data.usuario_cargo,
              sucursal_id: data.sucursal_id,
              sucursal_nombre: data.sucursal_nombre,
              modulo: data.modulo,
              tipo_accion: data.tipo_accion || data.accion,
              descripcion: data.descripcion,
              detalles: data.detalles,
            });
          });
          onLogsUpdated(logs);
        }
      },
      (err) => {
        console.warn('Firestore auditoria notice:', err);
        if (onError) onError(err);
      }
    );
  } catch (e: any) {
    console.warn('Error starting auditoria listener:', e);
    return () => {};
  }
}

