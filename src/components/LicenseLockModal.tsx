import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  KeyRound,
  Copy,
  Check,
  Lock,
  Unlock,
  Building2,
  Calendar,
  AlertCircle,
  Sparkles,
  Terminal,
  RefreshCw,
  Cpu,
  Fingerprint,
} from 'lucide-react';
import {
  getMachineFingerprint,
  validateActivationKey,
  saveLicenseKey,
  LicenseValidationResult,
  LicensePayload,
} from '../lib/licensing';

interface LicenseLockModalProps {
  validationResult: LicenseValidationResult;
  onLicenseActivated: (key: string) => void;
  canDismiss?: boolean;
  onClose?: () => void;
}

export const LicenseLockModal: React.FC<LicenseLockModalProps> = ({
  validationResult,
  onLicenseActivated,
  canDismiss = false,
  onClose,
}) => {
  const [machineId, setMachineId] = useState<string>('');
  const [inputKey, setInputKey] = useState<string>('');
  const [copiedId, setCopiedId] = useState<boolean>(false);
  const [copiedKey, setCopiedKey] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successPayload, setSuccessPayload] = useState<LicensePayload | null>(null);

  useEffect(() => {
    setMachineId(getMachineFingerprint());
  }, []);

  const handleCopyId = () => {
    if (!machineId) return;
    navigator.clipboard.writeText(machineId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2500);
  };

  const handleActivate = async () => {
    const key = inputKey.trim();
    if (!key) {
      setErrorMsg('Por favor ingrese o pegue la clave de licencia provista por el desarrollador.');
      return;
    }

    const res = await validateActivationKey(key);
    if (!res.isValid) {
      setErrorMsg(res.message);
      setSuccessPayload(null);
      return;
    }

    setErrorMsg(null);
    setSuccessPayload(res.license || null);
    saveLicenseKey(key);
    onLicenseActivated(key);
    if (onClose) onClose();
  };

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/50 p-6 border-b border-slate-800 flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Fingerprint className="w-6 h-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-white tracking-wide">
                Activación y Licencia de Software
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Installation ID
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Licencia asociada al identificador de instalación de este equipo.
            </p>
          </div>
          {canDismiss && onClose && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Modal Content */}
        <div className="p-6 space-y-5">
          {/* Machine ID Box */}
          <div className="bg-slate-950/80 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-400" />
                ID de instalación de este POS:
              </span>
              <button
                onClick={handleCopyId}
                className="text-xs font-semibold text-indigo-400 hover:text-indigo-300 flex items-center gap-1 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 py-1 rounded-lg transition-colors border border-indigo-500/20"
              >
                {copiedId ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400 font-bold">¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar ID</span>
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center justify-between bg-slate-900 px-3.5 py-2.5 rounded-lg border border-slate-700/60">
              <span className="font-mono text-base font-bold text-emerald-400 tracking-wider">
                {machineId || 'CALCULANDO...'}
              </span>
              <span className="text-[11px] text-slate-400 bg-slate-800 px-2 py-0.5 rounded">
                Instalación
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-2 leading-relaxed">
              Envíe este <strong className="text-slate-300">ID de instalación</strong> a su desarrollador para recibir la clave de activación autorizada para esta máquina.
            </p>
          </div>

          {/* License Status / Alerts */}
          {validationResult.status === 'machine_mismatch' && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 flex items-start gap-3">
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div className="text-xs text-rose-200">
                <p className="font-bold">Equipo No Autorizado (Copia detectada)</p>
                <p className="mt-0.5 text-rose-300/90">{validationResult.message}</p>
              </div>
            </div>
          )}

          {validationResult.status === 'expired' && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-200">
                <p className="font-bold">Licencia Expirada</p>
                <p className="mt-0.5 text-amber-300/90">{validationResult.message}</p>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3.5 flex items-start gap-3 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <p className="text-xs text-rose-300">{errorMsg}</p>
            </div>
          )}

          {successPayload && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3.5 flex items-start gap-3 animate-in fade-in">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-200">
                <p className="font-bold">¡Licencia Validada con Éxito!</p>
                <p className="mt-0.5 text-emerald-300/90">
                  Empresa: <strong>{successPayload.empresa}</strong> ({successPayload.rif})
                </p>
                <p className="text-emerald-400/80 mt-0.5">
                  Vigencia: {successPayload.fechaVencimiento === 'VITALICIA' ? 'Vitalicia' : `Hasta ${successPayload.fechaVencimiento}`}
                </p>
              </div>
            </div>
          )}

          {/* Activation Key Input */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-amber-400" />
                Clave de Activación Criptográfica:
              </span>
              <span className="text-[11px] text-slate-400 font-mono">Formato POSLIC1...</span>
            </label>
            <textarea
              rows={3}
              value={inputKey}
              onChange={(e) => {
                setInputKey(e.target.value);
                setErrorMsg(null);
              }}
              placeholder="Pegue aquí la clave de licencia (Ej: POSLIC1...)"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-indigo-500 transition-colors resize-none placeholder:text-slate-600"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
            <button
              onClick={handleActivate}
              className="w-full sm:flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer"
            >
              <Unlock className="w-4 h-4" />
              Validar y Desbloquear Sistema
            </button>
          </div>


        </div>
      </div>
    </div>
  );
};
