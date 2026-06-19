import { useState, useEffect } from 'react';
import axios from 'axios';
import { Database, Terminal, Play, HelpCircle, Eye, Sliders, ChevronDown, ChevronRight, Activity, Cpu, BarChart2, Zap } from 'lucide-react';
import VectorVisualization from './VectorVisualization';
import './index.css';

const API_BASE = 'http://localhost:5000/api';

// Utility for formatting speedup multiplier
const round = (num, decimals = 1) => {
  if (isNaN(num) || !isFinite(num)) return 1.0;
  return Number(num.toFixed(decimals));
};

// Collapsible Vector display cell with hover tooltip
const VectorCell = ({ val }) => {
  const [hovered, setHovered] = useState(false);
  if (!Array.isArray(val)) return String(val);
  
  const dim = val.length;
  const displayStr = dim > 5 
    ? `[${val.slice(0, 3).map(x => x.toFixed(2)).join(', ')}, ..., ${val.slice(-2).map(x => x.toFixed(2)).join(', ')}] (${dim}D)`
    : `[${val.map(x => typeof x === 'number' ? x.toFixed(3) : String(x)).join(', ')}]`;

  return (
    <div 
      className="vector-cell-container"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <span style={{ 
        color: '#c084fc', 
        fontFamily: "'Fira Code', monospace", 
        fontWeight: 600,
        background: 'rgba(139, 92, 246, 0.12)',
        border: '1px solid rgba(139, 92, 246, 0.28)',
        borderRadius: '6px',
        padding: '0.15rem 0.4rem',
        fontSize: '0.8rem',
        cursor: 'help'
      }}>
        {displayStr}
      </span>
      {hovered && (
        <div className="vector-tooltip">
          <div className="vector-tooltip-title">Embedding Vector ({dim}D)</div>
          <div className="vector-tooltip-body">[{val.join(', ')}]</div>
        </div>
      )}
    </div>
  );
};

// CSS-based animated benchmark timing comparison bar
const SpeedupBar = ({ label, time, isIndexed, maxTime }) => {
  const percentage = maxTime > 0 ? (time / maxTime) * 100 : 0;
  return (
    <div style={{ marginBottom: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.3rem' }}>
        <span style={{ color: isIndexed ? '#10b981' : '#f97316', fontWeight: 600 }}>
          {isIndexed ? '⚡ ' : '🐢 '} {label}
        </span>
        <span style={{ color: 'var(--text-secondary)' }}>{time.toFixed(2)} ms</span>
      </div>
      <div style={{ height: '8px', background: 'rgba(255,255,255,0.05)', borderRadius: '9999px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${percentage}%`,
          background: isIndexed 
            ? 'linear-gradient(90deg, #10b981, #34d399)' 
            : 'linear-gradient(90deg, #f97316, #fb923c)',
          borderRadius: '9999px',
          transition: 'width 0.8s cubic-bezier(0.4, 0, 0.2, 1)'
        }} />
      </div>
    </div>
  );
};

function App() {
  const [serverStatus, setServerStatus] = useState('Checking...');
  const [isConnected, setIsConnected] = useState(false);
  const [tables, setTables] = useState([]);
  const [selectedTable, setSelectedTable] = useState('');
  
  // SQL console state
  const [sqlQuery, setSqlQuery] = useState("select id, emb, tag from t_vec;");
  const [queryLoading, setQueryLoading] = useState(false);
  const [queryResult, setQueryResult] = useState(null);
  const [queryTiming, setQueryTiming] = useState(null);
  
  // Table schema accordion state
  const [expandedTables, setExpandedTables] = useState({});

  // Visualization state
  const [tableData, setTableData] = useState([]);
  const [dimX, setDimX] = useState(0);
  const [dimY, setDimY] = useState(1);
  const [availableDimensions, setAvailableDimensions] = useState(2);
  const [vectorColName, setVectorColName] = useState('');
  const [selectedTableIndexes, setSelectedTableIndexes] = useState([]);

  // Right Panel Tabs
  const [activeRightTab, setActiveRightTab] = useState('visual'); // 'visual' | 'benchmark'

  // Vector Search form state
  const [searchTargetInput, setSearchTargetInput] = useState('[0, 0, 0]');
  const [searchMetric, setSearchMetric] = useState('euclidean');
  const [searchK, setSearchK] = useState(3);
  const [searchLoading, setSearchLoading] = useState(false);

  // Search Results for Plotting
  const [plottedTarget, setPlottedTarget] = useState(null);
  const [plottedNeighbors, setPlottedNeighbors] = useState([]);

  // Vector Generator (DML Helper) state
  const [showVectorGen, setShowVectorGen] = useState(false);
  const [genDim, setGenDim] = useState(3);
  const [genStyle, setGenStyle] = useState('random_float');

  const generateVectorString = () => {
    const arr = [];
    for (let i = 0; i < genDim; i++) {
      if (genStyle === 'random_float') {
        arr.push(parseFloat((Math.random() * 2 - 1).toFixed(3)));
      } else if (genStyle === 'random_int') {
        arr.push(Math.floor(Math.random() * 10));
      } else if (genStyle === 'sequential') {
        arr.push(i + 1);
      } else {
        arr.push(0);
      }
    }
    return `string_to_vector('[${arr.join(',')}]')`;
  };

  // Benchmark State
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState(null);

  // Fetch tables and connection status
  const checkStatus = async () => {
    try {
      const response = await axios.get(`${API_BASE}/tables`);
      if (response.data.success) {
        setIsConnected(true);
        setServerStatus('Connected to MiniOB');
        setTables(response.data.tables);
        
        // Auto-select first vector table if none is selected
        if (!selectedTable && response.data.tables.length > 0) {
          const firstVecTable = response.data.tables.find(t => t.is_vector);
          if (firstVecTable) {
            setSelectedTable(firstVecTable.name);
          } else {
            setSelectedTable(response.data.tables[0].name);
          }
        }
      } else {
        setIsConnected(false);
        setServerStatus('Database Error');
      }
    } catch (error) {
      setIsConnected(false);
      setServerStatus('Offline (Cannot connect to Flask)');
    }
  };

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Update visualization data when selected table changes
  useEffect(() => {
    if (!selectedTable) return;
    fetchTableData(selectedTable);
  }, [selectedTable, tables]);

  const fetchTableData = async (tableName) => {
    try {
      const response = await axios.get(`${API_BASE}/table-data/${tableName}`);
      if (response.data.success && response.data.result.type === 'table') {
        const rows = response.data.result.rows || [];
        
        // Find schema info
        const tableSchema = tables.find(t => t.name === tableName);
        let vectorCol = '';
        let dimensions = 2;
        let indexes = [];
        
        if (tableSchema) {
          indexes = tableSchema.indexes || [];
          if (tableSchema.is_vector && tableSchema.vector_columns.length > 0) {
            vectorCol = tableSchema.vector_columns[0].name;
            dimensions = parseInt(tableSchema.vector_columns[0].dimension) || 2;
          }
        }
        
        if (!vectorCol) {
          // Fallback: look for array fields in rows
          const firstRow = rows[0];
          if (firstRow) {
            for (const key of Object.keys(firstRow)) {
              if (Array.isArray(firstRow[key])) {
                vectorCol = key;
                dimensions = firstRow[key].length;
                break;
              }
            }
          }
        }
        
        setVectorColName(vectorCol);
        setAvailableDimensions(dimensions);
        setSelectedTableIndexes(indexes);
        
        // Reset dims to standard
        setDimX(0);
        setDimY(dimensions > 1 ? 1 : 0);

        // Format data
        const formattedData = rows.map(row => ({
          id: row.id !== undefined ? row.id : 'N/A',
          tag: row.tag || '',
          vector: Array.isArray(row[vectorCol]) ? row[vectorCol] : []
        })).filter(item => item.vector.length > 0);

        setTableData(formattedData);
        
        // Set search placeholder according to dimension size
        setSearchTargetInput(`[${Array(dimensions).fill(0).join(', ')}]`);
      } else {
        setTableData([]);
        setSelectedTableIndexes([]);
      }
    } catch (err) {
      console.error("Error fetching table data:", err);
      setTableData([]);
      setSelectedTableIndexes([]);
    }
  };

  const handleRunQuery = async (queryText = sqlQuery) => {
    setQueryLoading(true);
    setQueryResult(null);
    setQueryTiming(null);
    try {
      const response = await axios.post(`${API_BASE}/query`, { sql: queryText });
      setQueryResult(response.data.result);
      setQueryTiming(response.data.timing || null);
      checkStatus(); // Refresh schema lists
    } catch (error) {
      setQueryResult({
        type: 'error',
        message: error.response?.data?.message || error.message || 'Unknown network error.'
      });
    } finally {
      setQueryLoading(false);
    }
  };

  const handleVectorSearch = async (e) => {
    e.preventDefault();
    if (!selectedTable || !vectorColName) {
      alert("Please select a table with vector columns first.");
      return;
    }
    
    let parsedTarget = null;
    try {
      parsedTarget = JSON.parse(searchTargetInput);
      if (!Array.isArray(parsedTarget)) throw new Error();
    } catch (err) {
      alert("Invalid vector format. Please enter a valid float array, e.g. [1, 2.5, -0.3]");
      return;
    }

    setSearchLoading(true);
    setPlottedTarget(parsedTarget);

    const querySql = `select id, ${vectorColName}, tag, distance(${vectorColName}, string_to_vector('${searchTargetInput}'), ${searchMetric}) as dis from ${selectedTable} order by dis asc limit ${searchK};`;

    try {
      const response = await axios.post(`${API_BASE}/query`, { sql: querySql });
      const result = response.data.result;

      if (response.data.success && result.type === 'table') {
        const neighbors = result.rows.map(row => ({
          id: row.id,
          tag: row.tag || '',
          vector: Array.isArray(row[vectorColName]) ? row[vectorColName] : [],
          distance: row.dis
        })).filter(n => n.vector.length > 0);

        setPlottedNeighbors(neighbors);
        setQueryResult(result);
        setQueryTiming(response.data.timing || null);
      } else {
        setPlottedNeighbors([]);
        setQueryResult(result);
      }
    } catch (error) {
      console.error("Search failed:", error);
      alert("Vector search execution failed. Check if table column is correct.");
    } finally {
      setSearchLoading(false);
    }
  };

  const handleRunBenchmark = async (e) => {
    e.preventDefault();
    if (!selectedTable || !vectorColName) {
      alert("Please select a table with vector columns first.");
      return;
    }

    try {
      const parsed = JSON.parse(searchTargetInput);
      if (!Array.isArray(parsed)) throw new Error();
    } catch (err) {
      alert("Invalid vector format. E.g. [0.5, 1.2, -0.8]");
      return;
    }

    setBenchmarkLoading(true);
    setBenchmarkResult(null);

    try {
      const response = await axios.post(`${API_BASE}/benchmark`, {
        table_name: selectedTable,
        vector_col: vectorColName,
        query_vector: searchTargetInput,
        metric: searchMetric,
        k: searchK
      });

      if (response.data.success) {
        setBenchmarkResult(response.data);
      } else {
        alert("Benchmark error: " + response.data.message);
      }
    } catch (error) {
      console.error("Benchmark failed:", error);
      alert("Benchmark connection error.");
    } finally {
      setBenchmarkLoading(false);
    }
  };

  const handleClearSearch = () => {
    setPlottedTarget(null);
    setPlottedNeighbors([]);
  };

  const toggleTableExpand = (tableName) => {
    setExpandedTables(prev => ({
      ...prev,
      [tableName]: !prev[tableName]
    }));
  };

  const loadPreset = (presetType) => {
    let sql = '';
    switch (presetType) {
      case 'create':
        sql = "create table t_vec(id int, emb vector(3), tag char);";
        break;
      case 'insert':
        sql = "insert into t_vec values(1, string_to_vector('[1, 0, 0]'), 'a');\ninsert into t_vec values(2, string_to_vector('[3, 0, 0]'), 'b');\ninsert into t_vec values(3, string_to_vector('[6, 0, 0]'), 'c');\ninsert into t_vec values(4, string_to_vector('[-2, 0, 0]'), 'd');";
        break;
      case 'index':
        sql = "create vector index idx_vec on t_vec(emb) with (distance=euclidean, type=ivfflat, lists=2, probes=1);";
        break;
      case 'select':
        sql = "select id, emb, tag from t_vec;";
        break;
      case 'search':
        sql = "select id, distance(emb, string_to_vector('[0,0,0]'), euclidean) as dis from t_vec order by dis asc limit 3;";
        break;
      default:
        sql = '';
    }
    setSqlQuery(sql);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="header">
        <div className="logo-container">
          <Database size={24} className="logo-icon" />
          <span className="logo-text">MiniOB Vector Console</span>
          <span className="version-badge">v1.2.0</span>
        </div>
        <div className="status-badge">
          <Activity size={14} className={isConnected ? "text-success" : "text-danger"} />
          <span style={{ color: isConnected ? '#10b981' : '#ef4444', fontWeight: 600 }}>
            {serverStatus}
          </span>
          <div className={`status-dot ${!isConnected && 'disconnected'}`}></div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="main-content">
        
        {/* Left Column: Schema Explorer */}
        <section className="panel-column">
          <div className="glass-panel flex-fill">
            <div className="panel-header">
              <h2 className="panel-title">
                <Database size={18} className="panel-icon" />
                Schema Explorer
              </h2>
              <button 
                onClick={checkStatus} 
                className="btn btn-secondary" 
                style={{ padding: '0.3rem 0.6rem', fontSize: '0.75rem' }}
                title="Refresh Schema"
              >
                Refresh
              </button>
            </div>
            
            <div className="schema-list">
              {tables.length === 0 ? (
                <div className="no-data-msg">
                  <HelpCircle size={24} className="no-data-icon" />
                  <p>No tables found in 'SYS' database.</p>
                </div>
              ) : (
                tables.map(table => (
                  <div key={table.name} className="table-schema-card">
                    <div 
                      className="table-schema-header"
                      onClick={() => toggleTableExpand(table.name)}
                    >
                      <span className="table-name-wrapper">
                        {expandedTables[table.name] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        <span style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>{table.name}</span>
                      </span>
                      {table.is_vector && <span className="vector-badge-icon">Vector</span>}
                    </div>

                    {expandedTables[table.name] && (
                      <div className="columns-list">
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Columns</div>
                        {table.columns.map(col => (
                          <div key={col.name} className="column-item">
                            <span className="column-name">{col.name}</span>
                            <span className="column-type">
                              {col.type}{col.type === 'vectors' || col.type === 'chars' ? `(${col.length})` : ''}
                            </span>
                          </div>
                        ))}
                        
                        {/* Render table indexes subtree if any */}
                        {table.indexes && table.indexes.length > 0 && (
                          <div style={{ marginTop: '0.6rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem' }}>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '0.2rem' }}>Indexes</div>
                            {table.indexes.map(idx => (
                              <div key={idx.name} className="column-item" style={{ fontSize: '0.75rem', opacity: 0.85, paddingLeft: '0.5rem', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.1rem', marginBottom: '0.3rem' }}>
                                <span className="column-name" style={{ color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                  <span>🗂</span>
                                  <strong>{idx.name}</strong>
                                </span>
                                <span className="column-type" style={{ fontSize: '0.7rem', color: '#c084fc', fontFamily: 'monospace' }}>
                                  ({idx.type}, {idx.distance}, lists={idx.lists}, probes={idx.probes})
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <button 
                          className="btn btn-secondary" 
                          style={{ padding: '0.2rem 0.4rem', fontSize: '0.7rem', marginTop: '0.6rem', width: 'auto', alignSelf: 'flex-start' }}
                          onClick={() => {
                            setSqlQuery(`select * from ${table.name} limit 10;`);
                            handleRunQuery(`select * from ${table.name} limit 10;`);
                          }}
                        >
                          Query Top 10
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Middle Column: SQL Terminal */}
        <section className="panel-column">
          <div className="glass-panel flex-fill">
            <div className="panel-header">
              <h2 className="panel-title">
                <Terminal size={18} className="panel-icon" />
                SQL Terminal
              </h2>
              <div className="sql-presets">
                <button className="preset-btn" onClick={() => loadPreset('create')}>Create Tab</button>
                <button className="preset-btn" onClick={() => loadPreset('insert')}>Insert</button>
                <button className="preset-btn" onClick={() => loadPreset('index')}>Index</button>
                <button className="preset-btn" onClick={() => loadPreset('select')}>Select</button>
                <button className="preset-btn" onClick={() => loadPreset('search')}>Search</button>
                <button 
                  className="preset-btn" 
                  style={{ borderColor: 'rgba(139, 92, 246, 0.4)', color: '#c084fc', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                  onClick={() => setShowVectorGen(!showVectorGen)}
                >
                  🧪 DML Helper
                </button>
              </div>
            </div>

            <div className="sql-console">
              {showVectorGen && (
                <div style={{
                  background: 'rgba(15, 23, 44, 0.6)',
                  border: '1px dashed rgba(139, 92, 246, 0.35)',
                  borderRadius: '10px',
                  padding: '0.8rem',
                  marginBottom: '0.8rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.6rem',
                  animation: 'fadeIn 0.25s ease-out'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      ⚡ Vector Input Generator (DML Helper)
                    </span>
                    <button 
                      className="preset-btn" 
                      style={{ padding: '0.1rem 0.4rem', fontSize: '0.65rem', margin: 0 }} 
                      onClick={() => setShowVectorGen(false)}
                    >
                      Hide
                    </button>
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr', gap: '0.6rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Dimension</label>
                      <select 
                        className="form-select" 
                        value={genDim} 
                        onChange={(e) => setGenDim(parseInt(e.target.value))} 
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <option value="2">2D (Plane)</option>
                        <option value="3">3D (Default)</option>
                        <option value="4">4D</option>
                        <option value="5">5D</option>
                        <option value="8">8D</option>
                        <option value="128">128D (High-Dim)</option>
                      </select>
                    </div>
                    
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>Distribution</label>
                      <select 
                        className="form-select" 
                        value={genStyle} 
                        onChange={(e) => setGenStyle(e.target.value)} 
                        style={{ padding: '0.3rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <option value="random_float">Random Float [-1, 1]</option>
                        <option value="random_int">Random Int [0, 9]</option>
                        <option value="sequential">Sequential [1, 2, ...]</option>
                        <option value="zero">Zeros [0, 0, ...]</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button 
                        type="button"
                        className="btn btn-primary"
                        style={{ 
                          width: '100%', 
                          padding: '0', 
                          fontSize: '0.75rem', 
                          height: '31px', 
                          background: 'linear-gradient(135deg, #8b5cf6, #d8b4fe)',
                          boxShadow: '0 2px 8px rgba(139, 92, 246, 0.2)'
                        }}
                        onClick={() => {
                          const vecStr = generateVectorString();
                          setSqlQuery(prev => {
                            const trimmed = prev.trim();
                            if (!trimmed) return vecStr;
                            if (trimmed.endsWith(';')) {
                              return trimmed.slice(0, -1) + ` ${vecStr};`;
                            }
                            return trimmed + ` ${vecStr}`;
                          });
                        }}
                      >
                        Insert Vector
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="sql-textarea-wrapper">
                <textarea 
                  className="sql-textarea"
                  value={sqlQuery}
                  onChange={(e) => setSqlQuery(e.target.value)}
                  placeholder="Enter SQL statement here..."
                  spellCheck="false"
                />
              </div>
              <div className="sql-actions">
                <button 
                  onClick={() => handleRunQuery()} 
                  className="btn btn-primary"
                  disabled={queryLoading}
                >
                  <Play size={14} />
                  {queryLoading ? 'Executing...' : 'Run Query'}
                </button>
              </div>
            </div>

            {/* Results Console */}
            <div className="panel-header" style={{ marginTop: '1.2rem', marginBottom: '0.8rem' }}>
              <h2 className="panel-title" style={{ fontSize: '0.95rem' }}>
                <Eye size={16} className="panel-icon" />
                Query Results
              </h2>
            </div>
            
            <div className="results-container">
              {queryLoading && (
                <div className="no-data-msg">
                  <Cpu size={24} className="no-data-icon" style={{ animation: 'spin 2s linear infinite' }} />
                  <p>Processing query on MiniOB engine...</p>
                </div>
              )}

              {!queryLoading && !queryResult && (
                <div className="no-data-msg">
                  <HelpCircle size={24} className="no-data-icon" />
                  <p>Execute a query to see outputs here.</p>
                </div>
              )}

              {!queryLoading && queryResult && (
                <>
                  {/* Execution Timing display */}
                  {queryTiming && (
                    <div style={{ 
                      display: 'grid', 
                      gridTemplateColumns: 'repeat(3, 1fr)', 
                      gap: '0.6rem', 
                      marginBottom: '1rem', 
                      background: 'rgba(15, 23, 44, 0.6)', 
                      padding: '0.6rem 0.8rem', 
                      borderRadius: '10px', 
                      border: '1px solid rgba(6, 182, 212, 0.25)' 
                    }}>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Engine Time</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#60a5fa', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                          ⚡ {queryTiming.engine_ms} ms
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid rgba(255, 255, 255, 0.05)' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Network Overhead</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#a78bfa', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                          📡 {queryTiming.network_ms} ms
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600, textTransform: 'uppercase' }}>Total Execution</span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#10b981', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                          ⏱ {queryTiming.total_ms} ms
                        </span>
                      </div>
                    </div>
                  )}

                  {queryResult.type === 'success' && (
                    <div className="result-status-card success">
                      <span>✓</span>
                      <span>{queryResult.message}</span>
                    </div>
                  )}

                  {queryResult.type === 'error' && (
                    <div className="result-status-card error">
                      <span>⚠</span>
                      <span>{queryResult.message}</span>
                    </div>
                  )}

                  {queryResult.type === 'table' && (
                    <div className="table-wrapper">
                      <table className="data-table">
                        <thead>
                          <tr>
                            {queryResult.headers.map((h, i) => (
                              <th key={i}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.rows.map((row, rIdx) => (
                            <tr key={rIdx}>
                              {queryResult.headers.map((h, cIdx) => {
                                const val = row[h];
                                return (
                                  <td key={cIdx}>
                                    {Array.isArray(val) ? <VectorCell val={val} /> : String(val)}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {queryResult.type === 'text' && (
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      {queryResult.data}
                    </pre>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* Right Column: Visualizer & Benchmark Dashboard */}
        <section className="panel-column">
          <div className="glass-panel flex-fill">
            
            {/* Tab Selector Header */}
            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '1rem' }}>
              <button 
                onClick={() => setActiveRightTab('visual')}
                style={{ 
                  padding: '0.5rem 1rem', 
                  background: 'none', 
                  border: 'none', 
                  color: activeRightTab === 'visual' ? '#60a5fa' : '#64748b', 
                  borderBottom: activeRightTab === 'visual' ? '2px solid #3b82f6' : '2px solid transparent', 
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <Sliders size={14} />
                Visualization
              </button>
              <button 
                onClick={() => setActiveRightTab('benchmark')}
                style={{ 
                  padding: '0.5rem 1rem', 
                  background: 'none', 
                  border: 'none', 
                  color: activeRightTab === 'benchmark' ? '#60a5fa' : '#64748b', 
                  borderBottom: activeRightTab === 'benchmark' ? '2px solid #3b82f6' : '2px solid transparent', 
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem'
                }}
              >
                <BarChart2 size={14} />
                Performance Benchmark
              </button>
              
              <select 
                className="form-select" 
                value={selectedTable}
                onChange={(e) => setSelectedTable(e.target.value)}
                style={{ width: 'auto', padding: '0.2rem 0.5rem', fontSize: '0.75rem', marginLeft: 'auto', alignSelf: 'center' }}
              >
                <option value="">-- Table --</option>
                {tables.map(t => (
                  <option key={t.name} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Render Tab Contents */}
            {activeRightTab === 'visual' ? (
              <>
                {/* Dimensional selectors */}
                {availableDimensions > 2 && (
                  <div className="settings-grid" style={{ padding: '0.6rem', marginBottom: '0.8rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>X-Axis Dim</label>
                      <select 
                        className="form-select" 
                        value={dimX} 
                        onChange={(e) => setDimX(parseInt(e.target.value))}
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                      >
                        {Array.from({ length: availableDimensions }).map((_, i) => (
                          <option key={i} value={i}>Dim {i}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Y-Axis Dim</label>
                      <select 
                        className="form-select" 
                        value={dimY} 
                        onChange={(e) => setDimY(parseInt(e.target.value))}
                        style={{ padding: '0.2rem 0.4rem', fontSize: '0.75rem' }}
                      >
                        {Array.from({ length: availableDimensions }).map((_, i) => (
                          <option key={i} value={i}>Dim {i}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Visual Area */}
                <div className="visualization-area">
                  {tableData.length === 0 ? (
                    <div className="no-data-msg">
                      <HelpCircle size={24} className="no-data-icon" />
                      <p>No vector data to plot in this table.<br/>Create a vector table and insert values.</p>
                    </div>
                  ) : (
                    <VectorVisualization 
                      vectors={tableData}
                      targetVector={plottedTarget}
                      nearestNeighbors={plottedNeighbors}
                      dimX={dimX}
                      dimY={dimY}
                      tableIndexes={selectedTableIndexes}
                    />
                  )}
                </div>

                {/* Interactive Search Simulator Form */}
                <form onSubmit={handleVectorSearch} style={{ marginTop: '1rem' }}>
                  <h3 className="form-label" style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.6rem', fontSize: '0.85rem' }}>
                    Distance Search Simulation
                  </h3>
                  <div className="settings-grid" style={{ gridTemplateColumns: '2fr 1.5fr 1fr', padding: '0.6rem', gap: '0.5rem', marginBottom: '0.8rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Target Vector</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        value={searchTargetInput}
                        onChange={(e) => setSearchTargetInput(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Metric</label>
                      <select 
                        className="form-select" 
                        value={searchMetric} 
                        onChange={(e) => setSearchMetric(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <option value="euclidean">Euclidean (L2)</option>
                        <option value="cosine">Cosine</option>
                        <option value="inner_product">Inner Product</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Top K</label>
                      <input 
                        type="number" 
                        className="form-input" 
                        value={searchK}
                        onChange={(e) => setSearchK(parseInt(e.target.value) || 1)}
                        min="1"
                        max="20"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.8rem' }}>
                    <button 
                      type="submit" 
                      className="btn btn-primary" 
                      style={{ flex: 1, padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      disabled={searchLoading || tableData.length === 0}
                    >
                      {searchLoading ? 'Searching...' : 'Run Search Query'}
                    </button>
                    {(plottedTarget || plottedNeighbors.length > 0) && (
                      <button 
                        type="button" 
                        onClick={handleClearSearch}
                        className="btn btn-secondary" 
                        style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem' }}
                      >
                        Clear Plot
                      </button>
                    )}
                  </div>
                </form>
              </>
            ) : (
              /* Performance Benchmark Tab Content */
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto' }}>
                <form onSubmit={handleRunBenchmark} style={{ marginBottom: '1.2rem' }}>
                  <h3 className="form-label" style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.6rem', fontSize: '0.85rem' }}>
                    Benchmark Parameters
                  </h3>
                  <div className="settings-grid" style={{ gridTemplateColumns: '2fr 1.5fr 1fr', padding: '0.6rem', gap: '0.5rem', marginBottom: '0.8rem' }}>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Query Vector</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        value={searchTargetInput}
                        onChange={(e) => setSearchTargetInput(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      />
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Metric</label>
                      <select 
                        className="form-select" 
                        value={searchMetric} 
                        onChange={(e) => setSearchMetric(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      >
                        <option value="euclidean">Euclidean (L2)</option>
                        <option value="cosine">Cosine</option>
                        <option value="inner_product">Inner Product</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label" style={{ fontSize: '0.7rem' }}>Top K</label>
                      <input 
                        type="number" 
                        className="form-input" 
                        value={searchK}
                        onChange={(e) => setSearchK(parseInt(e.target.value) || 1)}
                        min="1"
                        max="20"
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}
                      />
                    </div>
                  </div>
                  <button 
                    type="submit" 
                    className="btn btn-primary" 
                    style={{ width: '100%', padding: '0.5rem 1rem', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'center', justifyContent: 'center' }}
                    disabled={benchmarkLoading || tableData.length === 0}
                  >
                    <Zap size={14} />
                    {benchmarkLoading ? 'Running Comparative Analysis...' : 'Run Comparative Benchmark'}
                  </button>
                </form>

                {benchmarkLoading && (
                  <div className="no-data-msg" style={{ flex: 1 }}>
                    <Cpu size={28} className="no-data-icon" style={{ animation: 'spin 2s linear infinite' }} />
                    <p>Executing K-Nearest Neighbors on Bruteforce vs IVF_Flat index...</p>
                  </div>
                )}

                {!benchmarkLoading && !benchmarkResult && (
                  <div className="no-data-msg" style={{ flex: 1 }}>
                    <BarChart2 size={28} className="no-data-icon" />
                    <p>Configure parameters above and run to analyze search performance.</p>
                  </div>
                )}

                {!benchmarkLoading && benchmarkResult && (
                  <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
                    {/* Performance Metrics Cards */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', marginBottom: '1.2rem' }}>
                      <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', padding: '0.8rem', borderRadius: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#a7f3d0', fontWeight: 600 }}>INDEX RECALL RATE</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#10b981', marginTop: '0.2rem' }}>
                          {benchmarkResult.recall}%
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          Matches Ground Truth
                        </div>
                      </div>
                      <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '0.8rem', borderRadius: '10px', textAlign: 'center' }}>
                        <div style={{ fontSize: '0.7rem', color: '#bfdbfe', fontWeight: 600 }}>SPEEDUP FACTOR</div>
                        <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#3b82f6', marginTop: '0.2rem' }}>
                          {round(benchmarkResult.bruteforce.time_ms / benchmarkResult.indexed.time_ms, 1)}x
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '0.2rem' }}>
                          Faster with IVF Index
                        </div>
                      </div>
                    </div>

                    {/* Timing Comparison Chart */}
                    <div style={{ background: 'rgba(15, 23, 42, 0.3)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '1rem', marginBottom: '1rem' }}>
                      <h4 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.8rem', color: 'var(--text-primary)' }}>
                        Search Latency (Lower is Better)
                      </h4>
                      <SpeedupBar 
                        label="Bruteforce Scan" 
                        time={benchmarkResult.bruteforce.time_ms} 
                        isIndexed={false} 
                        maxTime={Math.max(benchmarkResult.bruteforce.time_ms, benchmarkResult.indexed.time_ms)} 
                      />
                      <SpeedupBar 
                        label="Indexed IVF_Flat" 
                        time={benchmarkResult.indexed.time_ms} 
                        isIndexed={true} 
                        maxTime={Math.max(benchmarkResult.bruteforce.time_ms, benchmarkResult.indexed.time_ms)} 
                      />
                    </div>

                    {/* Results Comparer Side-by-Side Table */}
                    <div style={{ background: 'rgba(15, 23, 42, 0.2)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.8rem' }}>
                      <h4 style={{ fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.6rem', color: 'var(--text-primary)' }}>
                        Top-{searchK} Nearest Neighbors Comparison
                      </h4>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', fontSize: '0.75rem' }}>
                        
                        {/* Bruteforce column */}
                        <div>
                          <div style={{ fontWeight: 600, color: '#f97316', borderBottom: '1px solid rgba(255,255,255,0.06)', height: '28px', lineHeight: '20px', paddingBottom: '0.2rem', marginBottom: '0.4rem', textAlign: 'center', boxSizing: 'border-box' }}>
                            Ground Truth (BF)
                          </div>
                          {benchmarkResult.bruteforce.results.map((res, i) => (
                            <div key={i} style={{ background: 'rgba(249, 115, 22, 0.04)', border: '1px solid rgba(249, 115, 22, 0.12)', padding: '0 0.6rem', height: '36px', boxSizing: 'border-box', borderRadius: '6px', marginBottom: '0.3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                              <span style={{ color: '#fdba74' }}>ID: {res.id}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{parseFloat(res.distance).toFixed(3)}</span>
                            </div>
                          ))}
                        </div>

                        {/* Indexed column */}
                        <div>
                          <div style={{ fontWeight: 600, color: '#10b981', borderBottom: '1px solid rgba(255,255,255,0.06)', height: '28px', lineHeight: '20px', paddingBottom: '0.2rem', marginBottom: '0.4rem', textAlign: 'center', boxSizing: 'border-box' }}>
                            IVF_Flat Index
                          </div>
                          {benchmarkResult.indexed.results.map((res, i) => {
                            const isMatch = benchmarkResult.bruteforce.results.some(x => x.id === res.id);
                            return (
                              <div key={i} style={{ background: isMatch ? 'rgba(16, 185, 129, 0.04)' : 'rgba(239, 68, 68, 0.04)', border: isMatch ? '1px solid rgba(16, 185, 129, 0.12)' : '1px solid rgba(239, 68, 68, 0.12)', padding: '0 0.6rem', height: '36px', boxSizing: 'border-box', borderRadius: '6px', marginBottom: '0.3rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                                <span style={{ color: isMatch ? '#34d399' : '#f87171' }}>ID: {res.id} {isMatch ? '✓' : '✗'}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{parseFloat(res.distance).toFixed(3)}</span>
                              </div>
                            );
                          })}
                        </div>

                      </div>
                    </div>

                  </div>
                )}
              </div>
            )}

          </div>
        </section>

      </main>
    </div>
  );
}

export default App;
