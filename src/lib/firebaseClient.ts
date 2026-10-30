import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
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
  limit,
} from 'firebase/firestore';
import firebaseConfigData from '../../firebase-applet-config.json';
import { Producto, PedidoOnline, EmpresaConfig, TiendaConfig, Sucursal, InventarioItem, Venta, Compra, Cliente, Proveedor, CuentaPorCobrar, CuentaPorPagar } from '../types';

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

// Firebase Authentication: all privileged Firestore access requires a verified Google session.
export const auth = getAuth(firebaseApp);

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
    await setDoc(doc(db, 'empresa_config', 'main'), config, { merge: true });
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
        // Un snapshot vacío también es un cambio válido: permite reflejar
        // que el catálogo fue vaciado intencionalmente en la nube.
        const prods: Producto[] = [];
        const seenIds = new Set<number>();

        snapshot.forEach((d) => {
          const product = d.data() as Partial<Producto>;
          // Algunos documentos antiguos pueden no tener el campo id.
          const documentId = Number(d.id);
          const resolvedId =
            Number.isSafeInteger(product.id) && Number(product.id) >= 0
              ? Number(product.id)
              : documentId;

          // No permitir IDs inválidos ni duplicados en el estado de React.
          if (!Number.isSafeInteger(resolvedId) || resolvedId < 0 || seenIds.has(resolvedId)) {
            console.warn(`Se omitió un producto de Firestore con ID inválido o duplicado: ${d.id}`);
            return;
          }

          seenIds.add(resolvedId);
          prods.push({
            ...product,
            id: resolvedId,
          } as Producto);
        });

        onProductosUpdated(prods);
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
 * Real-time listener for stock by branch and product.
 */
export function subscribeToInventario(
  onInventarioUpdated: (items: InventarioItem[]) => void,
  onError?: (err: Error) => void
) {
  try {
    return onSnapshot(
      collection(db, 'inventario'),
      (snapshot) => {
        const items: InventarioItem[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as Partial<InventarioItem>;
          const [branchFromId, productFromId] = d.id.split('_').map(Number);
          const sucursal_id = Number.isSafeInteger(data.sucursal_id) ? Number(data.sucursal_id) : branchFromId;
          const producto_id = Number.isSafeInteger(data.producto_id) ? Number(data.producto_id) : productFromId;
          const stock = Number(data.stock);

          if (!Number.isSafeInteger(sucursal_id) || sucursal_id < 0 ||
              !Number.isSafeInteger(producto_id) || producto_id < 0 ||
              !Number.isFinite(stock) || stock < 0) {
            console.warn(`Se omitió un registro de inventario inválido: ${d.id}`);
            return;
          }

          items.push({
            ...(data as InventarioItem),
            id: Number.isSafeInteger(data.id) ? Number(data.id) : items.length + 1,
            sucursal_id,
            producto_id,
            stock,
          });
        });
        onInventarioUpdated(items);
      },
      (err) => {
        console.warn('Firestore inventario subscription notice:', err);
        onError?.(err);
      }
    );
  } catch (e: any) {
    console.warn('Error starting inventario listener:', e);
    onError?.(e instanceof Error ? e : new Error(String(e)));
    return () => {};
  }
}

/**
 * Replaces the Firestore stock collection with the current application state.
 * This intentionally removes remote stock rows no longer present locally.
 */
export async function replaceInventarioInFirestore(items: InventarioItem[]): Promise<boolean> {
  try {
    const seen = new Set<string>();
    const desired = items.map((item) => {
      if (!Number.isSafeInteger(item.sucursal_id) || item.sucursal_id < 0 ||
          !Number.isSafeInteger(item.producto_id) || item.producto_id < 0 ||
          !Number.isFinite(item.stock) || item.stock < 0) {
        throw new Error('Hay un registro de inventario inválido.');
      }
      const documentId = `${item.sucursal_id}_${item.producto_id}`;
      if (seen.has(documentId)) throw new Error('Hay productos duplicados para una misma sucursal en el inventario.');
      seen.add(documentId);
      return { documentId, data: item };
    });

    const existing = await getDocs(collection(db, 'inventario'));
    const operations: Array<{ type: 'set' | 'delete'; id: string; data?: InventarioItem }> = [];
    existing.forEach((d) => {
      if (!seen.has(d.id)) operations.push({ type: 'delete', id: d.id });
    });
    desired.forEach((item) => operations.push({ type: 'set', id: item.documentId, data: item.data }));

    const BATCH_SIZE = 450;
    for (let offset = 0; offset < operations.length; offset += BATCH_SIZE) {
      const batch = writeBatch(db);
      operations.slice(offset, offset + BATCH_SIZE).forEach((operation) => {
        const ref = doc(db, 'inventario', operation.id);
        if (operation.type === 'delete') batch.delete(ref);
        else batch.set(ref, operation.data);
      });
      await batch.commit();
    }
    return true;
  } catch (error) {
    console.error('Error replacing inventario in Firestore:', error);
    return false;
  }
}

/**
 * Synchronize full local product catalog and stock to Firestore
 */
export async function syncAllToFirestore({
  productos,
  empresaConfig,
  tiendaConfig,
  sucursales,
  inventario,
  ventas,
  compras,
  clientes,
  proveedores,
  cxc,
  cxp,
}: {
  productos: Producto[];
  empresaConfig: EmpresaConfig;
  tiendaConfig: TiendaConfig;
  sucursales: Sucursal[];
  inventario: InventarioItem[];
  ventas?: Venta[];
  compras?: Compra[];
  clientes?: Cliente[];
  proveedores?: Proveedor[];
  cxc?: CuentaPorCobrar[];
  cxp?: CuentaPorPagar[];
}): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    // Firestore permite como máximo 500 operaciones por lote. Usamos 450
    // para mantener un margen y no perder catálogos grandes por ese límite.
    const BATCH_SIZE = 450;
    const writes: Array<{ collectionName: string; documentId: string; data: unknown }> = [];

    for (const prod of productos) {
      if (!Number.isSafeInteger(prod.id) || prod.id < 0) {
        throw new Error('Hay un producto con identificador inválido. No se inició la sincronización.');
      }
      writes.push({ collectionName: 'productos', documentId: String(prod.id), data: prod });
    }

    for (const suc of sucursales) {
      if (!Number.isSafeInteger(suc.id) || suc.id < 0) {
        throw new Error('Hay una sucursal con identificador inválido. No se inició la sincronización.');
      }
      writes.push({ collectionName: 'sucursales', documentId: String(suc.id), data: suc });
    }

    for (const item of inventario) {
      if (!Number.isSafeInteger(item.sucursal_id) || item.sucursal_id < 0 ||
          !Number.isSafeInteger(item.producto_id) || item.producto_id < 0 ||
          !Number.isFinite(item.stock) || item.stock < 0) {
        throw new Error('Hay un registro de inventario inválido. No se inició la sincronización.');
      }
      writes.push({
        collectionName: 'inventario',
        documentId: `${item.sucursal_id}_${item.producto_id}`,
        data: item,
      });
    }

    const financialCollections: Array<{ name: string; records: Array<{ registroId?: string }> }> = [
      { name: 'ventas', records: ventas || [] },
      { name: 'compras', records: compras || [] },
      { name: 'clientes', records: clientes || [] },
      { name: 'proveedores', records: proveedores || [] },
      { name: 'cuentas_por_cobrar', records: cxc || [] },
      { name: 'cuentas_por_pagar', records: cxp || [] },
    ];
    for (const group of financialCollections) {
      for (const record of group.records) {
        if (!record.registroId || !/^[A-Za-z0-9-]{16,80}$/.test(record.registroId)) {
          throw new Error(`No se sincronizó ${group.name}: hay registros sin identificador único. Primero deben migrarse de forma segura.`);
        }
        writes.push({
          collectionName: group.name,
          documentId: record.registroId,
          data: record,
        });
      }
    }

    // Comprobar todas las escrituras de configuración antes de informar éxito.
    const companySaved = await saveEmpresaConfigToFirestore(empresaConfig);
    if (!companySaved) throw new Error('No se pudo guardar la configuración de la empresa.');
    const storeSaved = await saveTiendaConfigToFirestore(tiendaConfig);
    if (!storeSaved) throw new Error('No se pudo guardar la configuración de la tienda.');

    for (let offset = 0; offset < writes.length; offset += BATCH_SIZE) {
      const batch = writeBatch(db);
      const chunk = writes.slice(offset, offset + BATCH_SIZE);
      for (const item of chunk) {
        batch.set(doc(db, item.collectionName, item.documentId), item.data, { merge: true });
      }
      await batch.commit();
    }

    return { success: true, count: productos.length };
  } catch (err: any) {
    console.error('Error syncing all to Firestore:', err);
    return { success: false, count: 0, error: err?.message || String(err) };
  }
}

/**
 * Load initial data from Firestore if present
 */
export async function fetchAllFromFirestore(): Promise<{
  productos?: Producto[];
  empresaConfig?: EmpresaConfig;
  tiendaConfig?: TiendaConfig;
  sucursales?: Sucursal[];
  inventario?: InventarioItem[];
  pedidos?: PedidoOnline[];
  ventas?: Venta[];
  compras?: Compra[];
  clientes?: Cliente[];
  proveedores?: Proveedor[];
  cxc?: CuentaPorCobrar[];
  cxp?: CuentaPorPagar[];
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

    // 3. Fetch productos
    const prodSnap = await getDocs(collection(db, 'productos'));
    if (!prodSnap.empty) {
      const prods: Producto[] = [];
      prodSnap.forEach((d) => prods.push(d.data() as Producto));
      result.productos = prods;
    }

    // 4. Fetch sucursales e inventario para reconstruir el stock por local.
    const sucSnap = await getDocs(collection(db, 'sucursales'));
    if (!sucSnap.empty) {
      const branches: Sucursal[] = [];
      sucSnap.forEach((d) => branches.push(d.data() as Sucursal));
      result.sucursales = branches;
    }

    const invSnap = await getDocs(collection(db, 'inventario'));
    if (!invSnap.empty) {
      const stockItems: InventarioItem[] = [];
      invSnap.forEach((d) => stockItems.push(d.data() as InventarioItem));
      result.inventario = stockItems;
    }

    // 6. Fetch financial records using stable Firestore document IDs.
    const financialCollections = [
      { collectionName: 'ventas', resultKey: 'ventas' },
      { collectionName: 'compras', resultKey: 'compras' },
      { collectionName: 'clientes', resultKey: 'clientes' },
      { collectionName: 'proveedores', resultKey: 'proveedores' },
      { collectionName: 'cuentas_por_cobrar', resultKey: 'cxc' },
      { collectionName: 'cuentas_por_pagar', resultKey: 'cxp' },
    ] as const;
    for (const item of financialCollections) {
      const snapshot = await getDocs(collection(db, item.collectionName));
      const records = snapshot.docs.map((entry) => ({ ...entry.data(), registroId: entry.id }));
      result[item.resultKey] = records;
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


/** Returns a short-lived Firebase ID token for authenticated server API requests. */
export async function getAdminAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Debes iniciar sesión con la cuenta administradora para continuar.');
  }
  return { Authorization: `Bearer ${await user.getIdToken()}` };
}
