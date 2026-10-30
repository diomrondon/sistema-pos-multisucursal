export interface LicensePayload {
  machineId: string;
  empresa: string;
  rif: string;
  tipo: 'vitalicia' | 'anual' | 'semestral' | 'mensual' | 'demo';
  fechaEmision: string;
  fechaVencimiento: string;
  cajasMax: number;
  sucursalesMax: number;
}
export interface LicenseValidationResult {
  isValid: boolean;
  isExpired: boolean;
  isMachineMismatch: boolean;
  isTampered: boolean;
  status: 'active' | 'expired' | 'machine_mismatch' | 'invalid_signature' | 'unlicensed';
  message: string;
  license?: LicensePayload;
  daysRemaining?: number;
}
const STORAGE_KEY_LICENSE = 'pos_app_crypto_license_v2';
const STORAGE_KEY_SEED = 'pos_machine_install_seed_v1';
export function getMachineFingerprint(): string {
  if (typeof window === 'undefined') return 'POS-SERVER-0000-0000';
  let seed = localStorage.getItem(STORAGE_KEY_SEED);
  if (!seed) {
    seed = crypto.randomUUID();
    localStorage.setItem(STORAGE_KEY_SEED, seed);
  }
  return 'POS-' + seed.replace(/-/g, '').slice(0, 16).toUpperCase();
}
export async function validateActivationKey(key: string, targetMachineId?: string): Promise<LicenseValidationResult> {
  const fail = (message: string, status: LicenseValidationResult['status'] = 'invalid_signature'): LicenseValidationResult => ({
    isValid: false, isExpired: status === 'expired', isMachineMismatch: status === 'machine_mismatch',
    isTampered: status === 'invalid_signature', status, message,
  });
  if (!key?.trim()) return fail('No se ha ingresado una clave de licencia.', 'unlicensed');
  const parts = key.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'POSLIC1') return fail('Clave antigua o formato no reconocido. Solicite una licencia nueva.');
  try {
    const payloadBytes = decode(parts[1]);
    const signature = decode(parts[2]);
    const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicensePayload;
    if (!payload || typeof payload.machineId !== 'string' || typeof payload.empresa !== 'string' ||
        !['vitalicia','anual','semestral','mensual','demo'].includes(payload.tipo) ||
        !Number.isInteger(payload.cajasMax) || !Number.isInteger(payload.sucursalesMax)) {
      return fail('Los datos de la licencia no son válidos.');
    }
    // La clave pública no es secreta. Se conserva localmente para poder
    // comprobar la firma de la licencia cuando el equipo esté sin internet.
    const cachedPublicKeyName = 'pos_license_public_key_v1';
    let publicKey = '';
    try {
      const response = await fetch('/api/licenses/public-key');
      if (response.ok) {
        const body = await response.json();
        if (typeof body?.publicKey === 'string' && body.publicKey.length > 100) {
          publicKey = body.publicKey;
          localStorage.setItem(cachedPublicKeyName, publicKey);
        }
      }
    } catch {
      // Sin conexión: intentar con la clave pública guardada en una verificación anterior.
    }
    if (!publicKey) {
      try {
        publicKey = localStorage.getItem(cachedPublicKeyName) || '';
      } catch {
        publicKey = '';
      }
    }
    if (!publicKey) {
      return fail('No hay conexión y este equipo todavía no tiene guardada la clave pública para verificar la licencia. Conéctese una vez a internet.');
    }
    const keyBytes = decode(publicKey);
    const cryptoKey = await crypto.subtle.importKey('spki', keyBytes, {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'}, false, ['verify']);
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, signature, new TextEncoder().encode(parts[1]));
    if (!valid) return fail('La firma digital de la licencia no es válida.');
    const currentId = (targetMachineId || getMachineFingerprint()).toUpperCase();
    if (payload.machineId.toUpperCase() !== currentId) return {...fail('La licencia pertenece a otra instalación.', 'machine_mismatch'), license: payload};
    let daysRemaining = 99999;
    if (payload.fechaVencimiento !== 'VITALICIA') {
      const expiry = new Date(payload.fechaVencimiento + 'T23:59:59');
      daysRemaining = Math.ceil((expiry.getTime() - new Date().setHours(0,0,0,0)) / 86400000);
      if (!Number.isFinite(expiry.getTime())) return fail('Fecha de vencimiento inválida.');
      if (daysRemaining < 0) return {...fail('La licencia ha vencido.', 'expired'), license: payload, daysRemaining: 0};
    }
    return {isValid:true,isExpired:false,isMachineMismatch:false,isTampered:false,status:'active',message:'Licencia verificada.',license:payload,daysRemaining};
  } catch {
    return fail('No se pudo verificar la licencia. Revise la clave e inténtelo de nuevo.');
  }
}
function decode(value: string): Uint8Array {
  const base64 = value.replace(/-/g,'+').replace(/_/g,'/');
  const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export function getStoredLicenseKey(): string {
  try { return localStorage.getItem(STORAGE_KEY_LICENSE) || ''; } catch { return ''; }
}
export function saveLicenseKey(key: string): void {
  try { localStorage.setItem(STORAGE_KEY_LICENSE, key.trim()); } catch {}
}
export function removeLicenseKey(): void {
  try { localStorage.removeItem(STORAGE_KEY_LICENSE); } catch {}
}
