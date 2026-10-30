import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, LogOut, Store, AlertCircle, Loader2 } from 'lucide-react';
import { GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { Usuario, Sucursal } from '../types';
import { INITIAL_USUARIOS } from '../data/mockData';
import { auth } from '../lib/firebaseClient';
import { ADMIN_EMAIL } from '../lib/security';

interface AuthHeaderProps {
  currentUser: Usuario | null;
  usuarios: Usuario[];
  sucursales: Sucursal[];
  onSelectUser: (user: Usuario) => void;
  onLogout: () => void;
  onOpenHtmlModal?: () => void;
  onOpenClientStore?: () => void;
}

export const AuthHeader: React.FC<AuthHeaderProps> = ({
  currentUser,
  usuarios,
  sucursales,
  onSelectUser,
  onLogout,
  onOpenHtmlModal,
  onOpenClientStore,
}) => {
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const handleGoogleLogin = async () => {
    setIsSigningIn(true);
    setAuthError(null);
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const credential = await signInWithPopup(auth, provider);
      const email = credential.user.email?.trim().toLowerCase();

      if (!credential.user.emailVerified || email !== ADMIN_EMAIL) {
        await signOut(auth);
        setAuthError(`Esta cuenta no tiene autorización de administrador. Inicia sesión con ${ADMIN_EMAIL}.`);
        return;
      }

      const adminUser = INITIAL_USUARIOS.find((user) => user.rol === 'admin');
      if (!adminUser) {
        await signOut(auth);
        setAuthError('No se encontró el perfil local del administrador. Contacta al soporte antes de continuar.');
        return;
      }
      onSelectUser(adminUser);
    } catch (error) {
      const authFailure = error as { code?: string; message?: string };
      const errorCode = authFailure?.code || 'auth/unknown';
      console.error('Error en el inicio de sesión con Google:', {
        code: errorCode,
        message: authFailure?.message || String(error),
        error,
      });

      // Si el navegador bloquea la ventana emergente, usar redirección en la misma pestaña.
      if (errorCode === 'auth/popup-blocked' || errorCode === 'auth/popup-closed-by-user') {
        try {
          await signInWithRedirect(auth, provider);
          return;
        } catch (redirectError) {
          const redirectFailure = redirectError as { code?: string; message?: string };
          console.error('Error en el inicio de sesión por redirección:', redirectError);
          setAuthError(
            'Google no pudo abrir el acceso (' + (redirectFailure?.code || 'error desconocido') +
            ': ' + (redirectFailure?.message || 'sin detalle') +
            '). Revisa la conexión y los dominios autorizados en Firebase.'
          );
          return;
        }
      }

      const friendlyMessages: Record<string, string> = {
        'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase. Agrega localhost a los dominios autorizados.',
        'auth/operation-not-allowed': 'El acceso con Google no está habilitado en Firebase Authentication.',
        'auth/popup-closed-by-user': 'La ventana de Google se cerró antes de terminar el acceso.',
        'auth/cancelled-popup-request': 'Hay otra solicitud de acceso abierta. Inténtalo una sola vez.',
        'auth/network-request-failed': 'No hay conexión estable con Google/Firebase. Comprueba internet.',
        'auth/too-many-requests': 'Google/Firebase bloqueó temporalmente los intentos. Espera un momento.',
      };
      setAuthError(
        (friendlyMessages[errorCode] || 'No se pudo completar el acceso con Google.') +
        ' Código: ' + errorCode + '.'
      );
    } finally {
      setIsSigningIn(false);
    }
  };

  const getSucursalName = (sucursalId: number | null) => {
    if (sucursalId === null) return 'Gerencia General / Admin Global';
    const branch = sucursales.find((item) => item.id === sucursalId);
    return branch ? branch.nombre : 'Sin sucursal asignada';
  };

  return (
    <div className="bg-slate-900 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center gap-1.5 font-bold text-slate-200">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Seguridad & Control de Accesos:</span>
        </div>
        {currentUser ? (
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-full border text-[11px] font-bold bg-purple-500/20 text-purple-300 border-purple-500/30">ADMIN</span>
            <span className="text-white font-semibold">{currentUser.nombre_completo}</span>
            <span className="text-slate-400">({currentUser.cargo})</span>
            <span className="text-slate-500 hidden sm:inline">• {getSucursalName(currentUser.sucursal_id)}</span>
          </div>
        ) : (
          <span className="text-amber-400 flex items-center gap-1">
            <Lock className="w-3.5 h-3.5" /> Sesión cerrada
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        {onOpenClientStore && (
          <button onClick={onOpenClientStore} className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 transition-colors cursor-pointer font-bold">
            <Store className="w-3.5 h-3.5" /><span className="hidden sm:inline">Tienda Online</span>
          </button>
        )}
        <span
          role="status"
          title={isOnline ? 'Hay conexión a internet' : 'Sin internet: se pueden usar los datos locales disponibles; la nube no sincroniza'}
          className={'px-2 py-1 rounded-lg border font-semibold ' + (isOnline ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-amber-300 border-amber-500/30 bg-amber-500/10')}
        >
          {isOnline ? 'En línea' : 'Sin internet'}
        </span>
        {currentUser ? (
          <button onClick={onLogout} className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer">
            <LogOut className="w-3.5 h-3.5" /><span>Cerrar sesión</span>
          </button>
        ) : (
          <button disabled={isSigningIn} onClick={handleGoogleLogin} className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-slate-950 font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm">
            {isSigningIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <span className="font-bold">G</span>}
            <span>{isSigningIn ? 'Conectando...' : 'Iniciar sesión con Google'}</span>
          </button>
        )}
        {currentUser?.rol === 'admin' && onOpenHtmlModal && (
          <button type="button" onClick={onOpenHtmlModal} className="px-3 py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold cursor-pointer">
            Descargar .HTML
          </button>
        )}
      </div>

      {authError && (
        <div role="alert" className="w-full flex items-center gap-2 text-rose-300 bg-rose-950/40 border border-rose-500/30 rounded-lg p-2">
          <AlertCircle className="w-4 h-4 shrink-0" />{authError}
        </div>
      )}
    </div>
  );
};
