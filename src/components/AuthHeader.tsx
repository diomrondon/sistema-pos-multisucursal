import React, { useState, useEffect } from 'react';
import { ShieldCheck, UserCheck, Lock, LogOut, Store, Calculator, KeyRound } from 'lucide-react';
import { Usuario, Sucursal } from '../types';
import { INITIAL_USUARIOS } from '../data/mockData';
import { verifyUserPin } from '../lib/security';

interface AuthHeaderProps {
  currentUser: Usuario | null;
  usuarios: Usuario[];
  sucursales: Sucursal[];
  onSelectUser: (user: Usuario) => void;
  onLogout: () => void;
  onOpenHtmlModal?: () => void;
  onOpenClientStore?: () => void;
  onOpenCalculator?: () => void;
  onLoginAudit?: (success: boolean, targetUser: Usuario, area: string) => void;
}

export const AuthHeader: React.FC<AuthHeaderProps> = ({
  currentUser,
  usuarios,
  sucursales,
  onSelectUser,
  onLogout,
  onOpenHtmlModal,
  onOpenClientStore,
  onOpenCalculator,
  onLoginAudit,
}) => {
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Filtrar usuarios de prueba heredados para que inicialmente sólo aparezca el Gerente General.
  // Cualquier usuario creado por el Gerente General en Configuración aparecerá aquí.
  const isLegacyMockUser = (u: Usuario) =>
    [
      'cajero1_t1',
      'cajero2_t1',
      'cajero3_t1',
      'supervisor_t1',
      'cajero1_t2',
      'cajero2_t2',
      'cajero3_t2',
      'supervisor_t2',
      'inv_jefe',
      'inv_operador1',
      'inv_operador2',
    ].includes(u.username);

  const realUsers = (Array.isArray(usuarios) && usuarios.length > 0 ? usuarios : INITIAL_USUARIOS)
    .filter((u) => !isLegacyMockUser(u))
    .map((u) => {
      // Estandarizar nombre del administrador a Gerente General
      if (u.rol === 'admin') {
        return {
          ...u,
          nombre_completo: 'Gerente General',
          cargo: 'Gerente General',
          sucursal_id: null,
        };
      }
      return u;
    });

  const availableUsers: Usuario[] = realUsers.length > 0 ? realUsers : INITIAL_USUARIOS;

  const [selectedUserId, setSelectedUserId] = useState<number>(() => {
    const admin = availableUsers.find((u) => u.rol === 'admin');
    return admin ? admin.id : availableUsers[0]?.id || 1;
  });
  const [enteredPin, setEnteredPin] = useState<string>('');
  const [errorPin, setErrorPin] = useState<string | null>(null);

  useEffect(() => {
    if (availableUsers.length > 0) {
      const exists = availableUsers.some((u) => u.id === selectedUserId);
      if (!exists) {
        const admin = availableUsers.find((u) => u.rol === 'admin');
        setSelectedUserId(admin ? admin.id : availableUsers[0].id);
      }
    }
  }, [availableUsers, selectedUserId]);

  const handleOpenLoginModal = () => {
    setErrorPin(null);
    setEnteredPin('');
    const admin = availableUsers.find((u) => u.rol === 'admin');
    if (currentUser) {
      setSelectedUserId(currentUser.id);
    } else if (admin) {
      setSelectedUserId(admin.id);
    } else if (availableUsers[0]) {
      setSelectedUserId(availableUsers[0].id);
    }
    setShowLoginModal(true);
  };

  const handleVerifyLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorPin(null);
    const targetUser = availableUsers.find((u) => u.id === selectedUserId) || availableUsers[0];
    if (!targetUser) {
      setErrorPin('Por favor selecciona un usuario válido.');
      return;
    }

    const isValid = await verifyUserPin(enteredPin, targetUser.pin, targetUser);
    if (isValid) {
      onSelectUser({
        ...targetUser,
        pin: enteredPin.trim(),
      });
      if (onLoginAudit) {
        onLoginAudit(true, targetUser, 'Inicio de Sesión');
      }
      setShowLoginModal(false);
      setEnteredPin('');
      setErrorPin(null);
    } else {
      if (onLoginAudit) {
        onLoginAudit(false, targetUser, 'Inicio de Sesión');
      }
      setErrorPin('PIN incorrecto. Por favor verifica e intenta nuevamente.');
    }
  };

  const getSucursalName = (sucursalId: number | null) => {
    if (sucursalId === null) return 'Gerencia General / Admin Global';
    const s = sucursales.find((item) => Number(item.id) === Number(sucursalId));
    return s ? s.nombre : `Sucursal ${sucursalId}`;
  };

  const getBadgeColor = (rol: string) => {
    switch (rol) {
      case 'admin':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/30';
      case 'supervisor':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
      case 'inventario':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'cajero':
      default:
        return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    }
  };

  return (
    <>
      <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 font-bold text-slate-200">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Seguridad & Control de Accesos:</span>
          </div>

          {currentUser ? (
            <button
              type="button"
              onClick={handleOpenLoginModal}
              className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-colors cursor-pointer text-left"
              title="Cambiar de usuario"
            >
              <span className={`px-2 py-0.5 rounded-full border text-[11px] font-bold ${getBadgeColor(currentUser.rol)}`}>
                {currentUser.rol.toUpperCase()}
              </span>
              <span className="text-white font-semibold">{currentUser.nombre_completo}</span>
              <span className="text-slate-400">({currentUser.cargo})</span>
              <span className="text-slate-500 hidden sm:inline">• {getSucursalName(currentUser.sucursal_id)}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleOpenLoginModal}
              className="text-amber-400 hover:text-amber-300 flex items-center gap-1.5 cursor-pointer underline font-medium"
            >
              <Lock className="w-3.5 h-3.5" /> Sesión cerrada (Haz clic para iniciar sesión)
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {onOpenCalculator && (
            <button
              type="button"
              onClick={onOpenCalculator}
              className="px-2.5 py-1 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 flex items-center gap-1.5 transition-colors cursor-pointer font-bold shadow-sm"
              title="Abrir Calculadora Comercial Multimoneda (Tecla F9)"
            >
              <Calculator className="w-3.5 h-3.5 text-purple-400" />
              <span className="hidden sm:inline">Calculadora</span>
              <span className="text-[9px] bg-purple-950/80 border border-purple-400/40 px-1 py-0.2 rounded text-purple-300 font-mono font-bold">F9</span>
            </button>
          )}

          {onOpenClientStore && (
            <button
              type="button"
              onClick={onOpenClientStore}
              className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition-colors cursor-pointer font-bold"
              title="Abrir Catálogo / Tienda en Línea en modo cliente"
            >
              <Store className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Tienda Online</span>
            </button>
          )}

          {currentUser ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleOpenLoginModal}
                className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition-colors cursor-pointer font-semibold"
                title="Cambiar de usuario"
              >
                <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Cambiar Usuario</span>
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                title="Cerrar la sesión activa"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Cerrar</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleOpenLoginModal}
              className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
            >
              <UserCheck className="w-4 h-4 stroke-[2.5]" />
              <span>Iniciar Sesión</span>
            </button>
          )}
        </div>
      </div>

      {/* MODAL DE INICIO DE SESIÓN ELEGANTE (SIN PINES VISIBLES) */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-sm w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Iniciar Sesión</h3>
                  <p className="text-xs text-slate-400">Control de acceso seguro</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowLoginModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleVerifyLogin} className="space-y-4">
              {/* CAMPO DE SELECCIÓN DE USUARIO */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">
                  Usuario:
                </label>
                {availableUsers.length === 1 ? (
                  <div className="w-full bg-slate-950 border border-slate-700 p-3 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="font-bold text-white text-sm block">
                        {availableUsers[0].nombre_completo}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {availableUsers[0].cargo}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold bg-purple-500/20 text-purple-300 border-purple-500/30">
                      ADMIN
                    </span>
                  </div>
                ) : (
                  <select
                    value={selectedUserId}
                    onChange={(e) => {
                      setSelectedUserId(Number(e.target.value));
                      setErrorPin(null);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 text-xs text-white p-3 rounded-xl focus:border-emerald-500 focus:outline-none cursor-pointer font-medium"
                  >
                    {availableUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.nombre_completo} — {u.cargo || u.rol.toUpperCase()}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* CAMPO DE PIN DE ACCESO */}
              <div>
                <label className="text-xs font-bold text-slate-300 block mb-1.5">
                  PIN de Acceso:
                </label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    autoFocus
                    placeholder="••••"
                    value={enteredPin}
                    onChange={(e) => {
                      setEnteredPin(e.target.value);
                      setErrorPin(null);
                    }}
                    className="w-full bg-slate-950 border border-slate-700 font-mono text-lg text-emerald-400 p-3 pr-10 rounded-xl focus:border-emerald-500 focus:outline-none tracking-widest placeholder:tracking-normal placeholder:text-slate-600 placeholder:text-sm text-center"
                  />
                  <KeyRound className="w-4 h-4 text-slate-500 absolute right-3 top-4" />
                </div>
                {errorPin && (
                  <p className="text-xs text-rose-400 mt-2 font-medium bg-rose-950/40 p-2.5 rounded-lg border border-rose-500/30">
                    {errorPin}
                  </p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="px-4 py-2 text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>Ingresar</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
