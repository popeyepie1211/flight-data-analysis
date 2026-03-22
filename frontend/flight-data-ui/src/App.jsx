import React, { useState, useEffect, useMemo } from 'react';
import { 
  Activity, Plane, ArrowDownRight, Anchor, AlertTriangle, 
  Clock, Server, ShieldCheck, MapPin, TrendingUp, TrendingDown 
} from 'lucide-react';
import { 
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, 
  Tooltip as RechartsTooltip, ResponsiveContainer 
} from 'recharts';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// --- STYLES & ASSETS INJECTION ---
// Inject Leaflet CSS dynamically to ensure map renders correctly in single-file setup
const injectLeafletStyles = () => {
  if (!document.getElementById('leaflet-css')) {
    const link = document.createElement('link');
    link.id = 'leaflet-css';
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
  }
};

// Custom DivIcon for aircraft markers to look like radar blips
const createAircraftIcon = (isWarning) => L.divIcon({
  className: 'custom-aircraft-icon',
  html: `
    <div class="relative flex h-4 w-4 items-center justify-center">
      ${isWarning ? 
        `<span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
         <span class="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>` 
        : 
        `<span class="relative inline-flex rounded-full h-2 w-2 bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"></span>`
      }
    </div>
  `,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

// --- MOCK DATA ENGINE ---
// India approximate bounding box
const INDIA_BOUNDS = { minLat: 8.0, maxLat: 37.0, minLng: 68.0, maxLng: 97.0 };

const generateInitialFlights = (count) => {
  return Array.from({ length: count }).map(() => {
    const isGrounded = Math.random() > 0.95;
    const isDescending = Math.random() > 0.8 && !isGrounded;
    return {
      id: `icao24-${Math.random().toString(16).slice(2, 8)}`,
      callsign: `AIC${Math.floor(Math.random() * 900) + 100}`,
      country: Math.random() > 0.7 ? 'International' : 'India',
      lat: INDIA_BOUNDS.minLat + Math.random() * (INDIA_BOUNDS.maxLat - INDIA_BOUNDS.minLat),
      lng: INDIA_BOUNDS.minLng + Math.random() * (INDIA_BOUNDS.maxLng - INDIA_BOUNDS.minLng),
      altitude: isGrounded ? 0 : Math.floor(Math.random() * 30000) + 5000,
      velocity: isGrounded ? 0 : Math.floor(Math.random() * 400) + 200, // knots
      vertical_rate: isGrounded ? 0 : (isDescending ? -(Math.random() * 20 + 5) : (Math.random() > 0.5 ? Math.random() * 10 : 0)),
      on_ground: isGrounded,
      timestamp: Date.now(),
      heading: Math.floor(Math.random() * 360)
    };
  });
};

const updateFlights = (flights) => {
  return flights.map(flight => {
    if (flight.on_ground) {
      // Small chance to take off
      if (Math.random() > 0.98) {
        return { ...flight, on_ground: false, altitude: 1000, vertical_rate: 15, velocity: 150 };
      }
      return { ...flight, timestamp: Date.now() };
    }

    // Move slightly based on heading (simplified)
    const latChange = (Math.cos(flight.heading * (Math.PI / 180)) * flight.velocity) / 360000;
    const lngChange = (Math.sin(flight.heading * (Math.PI / 180)) * flight.velocity) / 360000;

    let newLat = flight.lat + latChange;
    let newLng = flight.lng + lngChange;

    // Keep within bounds (bounce)
    if (newLat < INDIA_BOUNDS.minLat || newLat > INDIA_BOUNDS.maxLat) flight.heading = (flight.heading + 180) % 360;
    if (newLng < INDIA_BOUNDS.minLng || newLng > INDIA_BOUNDS.maxLng) flight.heading = (flight.heading + 180) % 360;

    // Update altitude
    let newAlt = flight.altitude + (flight.vertical_rate * 5); // arbitrary multiplier for visualization
    if (newAlt < 0) { newAlt = 0; flight.on_ground = true; flight.velocity = 0; }
    if (newAlt > 40000) { newAlt = 40000; flight.vertical_rate = 0; }

    return {
      ...flight,
      lat: newLat,
      lng: newLng,
      altitude: newAlt,
      timestamp: Date.now(),
      // Add a slight jitter to velocity and vertical rate for realism
      velocity: Math.max(100, flight.velocity + (Math.random() * 10 - 5)),
      vertical_rate: flight.vertical_rate + (Math.random() * 2 - 1)
    };
  });
};

// --- COMPONENTS ---

const Card = ({ children, className = '', title, action }) => (
  <div className={`bg-[#111827] border border-slate-800 rounded-xl overflow-hidden shadow-lg shadow-black/20 flex flex-col transition-all duration-300 hover:border-slate-700 ${className}`}>
    {title && (
      <div className="px-4 py-3 border-b border-slate-800/60 flex justify-between items-center bg-slate-900/30">
        <h3 className="text-xs font-semibold text-slate-300 tracking-wider uppercase flex items-center gap-2">
          {title}
        </h3>
        {action && <div>{action}</div>}
      </div>
    )}
    <div className="p-4 flex-1 flex flex-col relative z-10">
      {children}
    </div>
  </div>
);

const KPICard = ({ title, value, icon, trend, trendValue, colorClass }) => (
  <div className="bg-[#111827] border border-slate-800 rounded-xl p-5 shadow-lg relative overflow-hidden group hover:border-slate-700 transition-colors duration-300">
    <div className={`absolute -right-6 -top-6 w-24 h-24 rounded-full opacity-10 blur-2xl group-hover:opacity-20 transition-opacity duration-500 ${colorClass.split(' ')[0].replace('text-', 'bg-')}`}></div>
    <div className="flex justify-between items-start">
      <div>
        <p className="text-sm font-medium text-slate-400 mb-1">{title}</p>
        <h4 className="text-3xl font-bold text-slate-100 font-mono tracking-tight">
          {value.toLocaleString()}
        </h4>
      </div>
      <div className={`p-2 rounded-lg bg-slate-900/50 border border-slate-800 ${colorClass}`}>
        {React.createElement(icon, { size: 20 })}
      </div>
    </div>
    {trend && (
      <div className="mt-4 flex items-center text-xs">
        <span className={trend === 'up' ? 'text-emerald-400' : 'text-rose-400'}>
          {trend === 'up' ? '↑' : '↓'} {trendValue}%
        </span>
        <span className="text-slate-500 ml-2">vs last hour</span>
      </div>
    )}
  </div>
);

export default function App() {
  const [flights, setFlights] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    injectLeafletStyles();
    // Simulate initial data load
    setTimeout(() => {
      setFlights(generateInitialFlights(120));
      setIsLoaded(true);
    }, 800);

    const interval = setInterval(() => {
      setFlights(prev => updateFlights(prev));
      setLastUpdate(new Date());
    }, 3000); // 3-second tick rate for "real-time" feel

    return () => clearInterval(interval);
  }, []);

  // --- DERIVED METRICS ---
  const activeFlights = flights.filter(f => !f.on_ground).length;
  const cruisingFlights = flights.filter(f => !f.on_ground && Math.abs(f.vertical_rate) < 2).length;
  const descendingFlights = flights.filter(f => !f.on_ground && f.vertical_rate < -5).length;
  const groundedFlights = flights.filter(f => f.on_ground).length;

  const altitudeData = useMemo(() => [
    { name: 'Low (< 10k)', value: flights.filter(f => f.altitude < 10000 && !f.on_ground).length },
    { name: 'Medium (10k-25k)', value: flights.filter(f => f.altitude >= 10000 && f.altitude < 25000 && !f.on_ground).length },
    { name: 'High (> 25k)', value: flights.filter(f => f.altitude >= 25000 && !f.on_ground).length },
  ], [flights]);
  const ALT_COLORS = ['#38bdf8', '#818cf8', '#c084fc'];

  const speedData = useMemo(() => {
    const bins = { '< 200kts': 0, '200-300': 0, '300-400': 0, '> 400kts': 0 };
    flights.filter(f => !f.on_ground).forEach(f => {
      if (f.velocity < 200) bins['< 200kts']++;
      else if (f.velocity < 300) bins['200-300']++;
      else if (f.velocity < 400) bins['300-400']++;
      else bins['> 400kts']++;
    });
    return Object.entries(bins).map(([name, count]) => ({ name, count }));
  }, [flights]);

  const alerts = useMemo(() => {
    return flights
      .filter(f => f.vertical_rate < -15 || f.altitude < 2000 && !f.on_ground)
      .slice(0, 6)
      .map(f => ({
        id: f.id,
        callsign: f.callsign,
        type: f.vertical_rate < -15 ? 'Rapid Descent' : 'Unusually Low',
        val: f.vertical_rate < -15 ? `${f.vertical_rate.toFixed(1)} m/s` : `${f.altitude.toFixed(0)} ft`,
        time: 'Just now'
      }));
  }, [flights]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#0B1020] flex flex-col items-center justify-center text-cyan-500">
        <Activity className="animate-spin mb-4" size={48} />
        <h2 className="text-xl font-mono tracking-widest text-slate-300 animate-pulse">INITIALIZING AWS KINESIS STREAM...</h2>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B1020] text-slate-200 font-sans selection:bg-cyan-900 overflow-hidden flex flex-col">
      {/* HEADER */}
      <header className="px-6 py-4 border-b border-slate-800/80 bg-[#0B1020]/90 backdrop-blur-md z-50 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-gradient-to-br from-cyan-500 to-blue-600 p-2 rounded-lg shadow-lg shadow-cyan-500/20">
            <Plane className="text-white" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">India Airspace Analytics</h1>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <Server size={12} className="text-emerald-400" />
              AWS Kinesis Real-Time Telemetry Pipeline
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2 mb-1">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
              <span className="text-xs font-bold text-cyan-400 tracking-widest uppercase">Live Stream</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">
              Last sync: {lastUpdate.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 1 })}
            </span>
          </div>
          <div className="h-8 w-px bg-slate-800"></div>
          <button className="text-slate-400 hover:text-white transition-colors">
            <ShieldCheck size={20} />
          </button>
        </div>
      </header>

      {/* MAIN CONTENT AREA */}
      <main className="flex-1 p-4 lg:p-6 overflow-y-auto overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto space-y-4 lg:space-y-6">
          
          {/* TOP KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
            <KPICard title="Active Flights" value={activeFlights} icon={Activity} colorClass="text-cyan-400" trend="up" trendValue={4.2} />
            <KPICard title="Cruising" value={cruisingFlights} icon={Plane} colorClass="text-emerald-400" trend="up" trendValue={1.8} />
            <KPICard title="Descending" value={descendingFlights} icon={ArrowDownRight} colorClass="text-amber-400" trend="down" trendValue={0.5} />
            <KPICard title="Grounded" value={groundedFlights} icon={Anchor} colorClass="text-slate-400" />
          </div>

          {/* MAIN GRID */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 h-[600px]">
            
            {/* LEFT: MAP HERO */}
            <Card title={<><MapPin size={16}/> Live Radar (Indian Region)</>} className="lg:col-span-8 lg:row-span-2 relative p-0 overflow-hidden">
              <div className="absolute inset-0 bg-slate-900 z-0 flex items-center justify-center">
                 <span className="animate-pulse text-slate-600 font-mono text-sm">Loading Map Tiles...</span>
              </div>
              <MapContainer 
                center={[22.0, 80.0]} 
                zoom={5} 
                zoomControl={false}
                scrollWheelZoom={true}
                className="w-full h-full z-10 relative bg-transparent"
                style={{ background: 'transparent' }}
              >
                <TileLayer
                  url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                  attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                />
                {flights.map(flight => (
                  <Marker 
                    key={flight.id} 
                    position={[flight.lat, flight.lng]}
                    icon={createAircraftIcon(flight.vertical_rate < -15)}
                  >
                    <Popup className="custom-popup">
                      <div className="bg-slate-900 p-3 rounded-lg border border-slate-700 shadow-xl text-slate-200 min-w-[180px]">
                        <div className="flex justify-between items-center mb-2 pb-2 border-b border-slate-700/50">
                          <span className="font-bold text-cyan-400 font-mono text-sm">{flight.callsign}</span>
                          <span className="text-xs bg-slate-800 px-2 py-0.5 rounded text-slate-400">{flight.country}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-2 text-xs">
                          <div className="text-slate-500">Altitude</div>
                          <div className="text-right font-mono">{Math.round(flight.altitude).toLocaleString()} ft</div>
                          <div className="text-slate-500">Speed</div>
                          <div className="text-right font-mono">{Math.round(flight.velocity)} kts</div>
                          <div className="text-slate-500">V. Rate</div>
                          <div className={`text-right font-mono ${flight.vertical_rate < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {flight.vertical_rate > 0 ? '+' : ''}{flight.vertical_rate.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
              {/* Overlay vignette for premium feel */}
              <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_80px_rgba(11,16,32,0.8)] z-20"></div>
            </Card>

            {/* RIGHT SIDEBAR */}
            <div className="lg:col-span-4 flex flex-col gap-4 lg:gap-6 h-full">
              
              {/* Altitude Donut */}
              <Card title="Altitude Distribution" className="flex-1">
                <div className="h-full w-full min-h-[160px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={altitudeData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={70}
                        paddingAngle={5}
                        dataKey="value"
                        stroke="none"
                      >
                        {altitudeData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={ALT_COLORS[index % ALT_COLORS.length]} />
                        ))}
                      </Pie>
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#111827', borderColor: '#334155', color: '#e2e8f0', borderRadius: '0.5rem' }}
                        itemStyle={{ color: '#e2e8f0' }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="flex justify-center gap-4 mt-2 text-xs">
                  {altitudeData.map((entry, index) => (
                    <div key={entry.name} className="flex items-center gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ALT_COLORS[index] }}></div>
                      <span className="text-slate-400">{entry.name}</span>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Speed Bar Chart */}
              <Card title="Speed Analysis (Knots)" className="flex-1">
                 <div className="h-full w-full min-h-[160px] pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={speedData} margin={{ top: 0, right: 0, left: -25, bottom: 0 }}>
                      <XAxis dataKey="name" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
                      <RechartsTooltip 
                        cursor={{ fill: '#1e293b' }}
                        contentStyle={{ backgroundColor: '#111827', borderColor: '#334155', borderRadius: '0.5rem' }}
                      />
                      <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Live Alerts */}
              <Card 
                title={<><AlertTriangle size={16} className="text-amber-400"/> Anomaly Detection</>} 
                className="flex-1"
                action={<span className="text-[10px] bg-amber-500/10 text-amber-400 px-2 py-0.5 rounded-full border border-amber-500/20">{alerts.length} Active</span>}
              >
                <div className="flex flex-col gap-2 overflow-y-auto h-full pr-1 custom-scrollbar -mx-2 px-2">
                  {alerts.length === 0 ? (
                    <div className="text-center text-sm text-slate-500 my-auto py-8">No current anomalies detected in stream.</div>
                  ) : (
                    alerts.map((alert, i) => (
                      <div key={`${alert.id}-${i}`} className="bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 rounded-lg p-3 flex justify-between items-center transition-colors">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-bold text-slate-200">{alert.callsign}</span>
                            <span className="text-[10px] bg-rose-500/20 text-rose-400 px-1.5 py-0.5 rounded uppercase">{alert.type}</span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1">Value: {alert.val}</div>
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock size={12} /> {alert.time}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Card>

            </div>
          </div>

          {/* BOTTOM ROW */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            <Card title="High Traffic Zones (FIR)">
              <div className="space-y-4 mt-2">
                {[
                  { name: 'Mumbai (VABB)', val: 42, color: 'bg-cyan-500' },
                  { name: 'Delhi (VIDP)', val: 38, color: 'bg-blue-500' },
                  { name: 'Bangalore (VOBL)', val: 24, color: 'bg-indigo-500' },
                ].map(zone => (
                  <div key={zone.name} className="flex flex-col gap-1">
                    <div className="flex justify-between text-xs text-slate-300">
                      <span>{zone.name}</span>
                      <span className="font-mono text-slate-400">{zone.val} vol</span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div className={`h-full ${zone.color} rounded-full`} style={{ width: `${(zone.val / 50) * 100}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="Traffic Composition">
              <div className="flex h-full items-center justify-center gap-8">
                <div className="text-center">
                  <div className="text-3xl font-bold text-slate-100 font-mono">
                    {Math.round((flights.filter(f => f.country === 'India').length / flights.length) * 100)}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider">Domestic</div>
                </div>
                <div className="h-12 w-px bg-slate-700"></div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-slate-100 font-mono">
                    {Math.round((flights.filter(f => f.country !== 'India').length / flights.length) * 100)}%
                  </div>
                  <div className="text-xs text-slate-400 mt-1 uppercase tracking-wider">International</div>
                </div>
              </div>
            </Card>

            <Card title="Vertical Trajectory">
              <div className="flex flex-col h-full justify-center space-y-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-500/10 rounded border border-emerald-500/20 text-emerald-400">
                    <TrendingUp size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1 text-slate-300">
                      <span>Climbing</span>
                      <span className="font-mono">{flights.filter(f => f.vertical_rate > 2 && !f.on_ground).length}</span>
                    </div>
                    <div className="h-1 w-full bg-slate-800 rounded"><div className="h-full bg-emerald-400 rounded w-1/3"></div></div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-500/10 rounded border border-amber-500/20 text-amber-400">
                    <TrendingDown size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between text-xs mb-1 text-slate-300">
                      <span>Descending</span>
                      <span className="font-mono">{flights.filter(f => f.vertical_rate < -2 && !f.on_ground).length}</span>
                    </div>
                    <div className="h-1 w-full bg-slate-800 rounded"><div className="h-full bg-amber-400 rounded w-1/4"></div></div>
                  </div>
                </div>
              </div>
            </Card>
          </div>

        </div>
      </main>

      {/* SCROLLBAR STYLES */}
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #475569; }
      `}} />
    </div>
  );
}