import React from 'react';
import { Cloud, Database, ShieldCheck, Server, Monitor, Smartphone } from 'lucide-react';

export const ArchitectureInfo: React.FC = () => {
  return (
    <div className="space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 text-white space-y-3">
        <span className="inline-flex items-center gap-2 bg-emerald-500/20 text-emerald-400 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-500/30">
          <Cloud className="w-3.5 h-3.5" /> Arquitectura actual del sistema
        </span>
        <h2 className="text-xl sm:text-2xl font-bold">POS multisucursal con Firebase</h2>
        <p className="text-slate-300 text-sm max-w-3xl leading-relaxed">
          El sistema utiliza Firebase Authentication para identificar a los usuarios y Cloud Firestore para almacenar y sincronizar los datos. El servidor Node.js/Express atiende operaciones que necesitan validación adicional.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <span className="text-xs font-bold font-mono text-emerald-400">AUTENTICACIÓN</span>
          <h3 className="font-bold text-white">Firebase Authentication</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Inicio de sesión con Google. La identidad se verifica antes de permitir operaciones protegidas.</p>
          <ShieldCheck className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <span className="text-xs font-bold font-mono text-emerald-400">BASE DE DATOS</span>
          <h3 className="font-bold text-white">Cloud Firestore</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Base de datos principal para productos, inventario, ventas, sucursales, pedidos y configuración, con reglas de acceso que deben validarse antes de publicar.</p>
          <Database className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <span className="text-xs font-bold font-mono text-emerald-400">SERVIDOR</span>
          <h3 className="font-bold text-white">Node.js + Express</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Procesa tareas del servidor y verifica los tokens de Firebase antes de aceptar solicitudes privadas.</p>
          <Server className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <span className="text-xs font-bold font-mono text-emerald-400">PUESTOS DE TRABAJO</span>
          <h3 className="font-bold text-white">POS de escritorio</h3>
          <p className="text-xs text-slate-400 leading-relaxed">Interfaz web para caja, administración, compras, inventario y control de sucursales.</p>
          <Monitor className="w-6 h-6 text-emerald-400" />
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3">
          <span className="text-xs font-bold font-mono text-emerald-400">TIENDA EN LÍNEA</span>
          <h3 className="font-bold text-white">Acceso público controlado</h3>
          <p className="text-xs text-slate-400 leading-relaxed">El catálogo y la recepción de pedidos deben exponerse mediante operaciones limitadas y validadas en servidor, sin revelar información interna.</p>
          <Smartphone className="w-6 h-6 text-emerald-400" />
        </div>
      </div>

      <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-5 text-sm text-slate-300">
        <strong className="text-amber-300">Estado de seguridad:</strong> La arquitectura está en proceso de endurecimiento. No publiques reglas ni despliegues los cambios hasta completar las pruebas de autenticación, permisos por sucursal, tienda en línea y sincronización.
      </div>
    </div>
  );
};
