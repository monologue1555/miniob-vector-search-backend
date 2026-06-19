import React, { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

// Simple K-Means implementation for IVF centroid representation
function runKMeans(points, k, maxIterations = 10) {
  if (points.length === 0 || k <= 0) return { centroids: [], assignments: [] };
  
  // Choose random points as initial centroids
  let centroids = [];
  const shuffled = [...points].sort(() => 0.5 - Math.random());
  centroids = shuffled.slice(0, Math.min(k, shuffled.length)).map(p => [...p]);
  
  let assignments = Array(points.length).fill(-1);
  let changed = true;
  let iterations = 0;
  
  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    
    // Assignment phase
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      let minDist = Infinity;
      let bestCentroid = -1;
      
      for (let j = 0; j < centroids.length; j++) {
        const c = centroids[j];
        let sumSq = 0;
        const len = Math.max(pt.length, c.length);
        for (let d = 0; d < len; d++) {
          const valP = pt[d] || 0;
          const valC = c[d] || 0;
          sumSq += Math.pow(valP - valC, 2);
        }
        const dist = Math.sqrt(sumSq);
        if (dist < minDist) {
          minDist = dist;
          bestCentroid = j;
        }
      }
      if (assignments[i] !== bestCentroid) {
        assignments[i] = bestCentroid;
        changed = true;
      }
    }
    
    // Update phase
    const clusters = Array.from({ length: k }, () => []);
    for (let i = 0; i < points.length; i++) {
      const assign = assignments[i];
      if (assign !== -1) {
        clusters[assign].push(points[i]);
      }
    }
    
    for (let j = 0; j < k; j++) {
      if (clusters[j].length > 0) {
        const dim = clusters[j][0].length;
        const mean = Array(dim).fill(0);
        for (let d = 0; d < dim; d++) {
          let sum = 0;
          for (let i = 0; i < clusters[j].length; i++) {
            sum += clusters[j][i][d] || 0;
          }
          mean[d] = sum / clusters[j].length;
        }
        centroids[j] = mean;
      }
    }
  }
  return { centroids, assignments };
}

const CLUSTER_COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4'];

const VectorVisualization = ({ vectors, targetVector, nearestNeighbors, dimX = 0, dimY = 1, tableIndexes }) => {
  const chartRef = useRef(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chartInstance = echarts.init(chartRef.current, 'dark', {
      renderer: 'canvas'
    });

    const series = [];

    // Check if table contains an IVF_Flat vector index to draw centroids
    const ivfIndex = tableIndexes && tableIndexes.find(idx => idx.type === 'ivfflat');
    const hasIvfIndex = !!ivfIndex && vectors.length > 0;
    const numLists = ivfIndex ? (ivfIndex.lists || 2) : 2;

    if (hasIvfIndex) {
      // 1. Run K-Means to find centroids and partition the dataset visually
      const rawVectors = vectors.map(v => v.vector || []);
      const km = runKMeans(rawVectors, numLists);
      
      const clusteredPoints = Array.from({ length: numLists }, () => []);
      km.assignments.forEach((clusterId, idx) => {
        const v = vectors[idx];
        const x = v.vector && v.vector.length > dimX ? v.vector[dimX] : 0;
        const y = v.vector && v.vector.length > dimY ? v.vector[dimY] : 0;
        
        if (clusterId !== -1 && clusterId < numLists) {
          clusteredPoints[clusterId].push({
            value: [x, y],
            id: v.id,
            tag: v.tag,
            fullVector: v.vector
          });
        }
      });

      // Plot each cluster with a unique neon color
      clusteredPoints.forEach((pts, i) => {
        if (pts.length === 0) return;
        series.push({
          name: `Cluster ${i}`,
          type: 'scatter',
          symbolSize: 8,
          data: pts,
          itemStyle: {
            color: CLUSTER_COLORS[i % CLUSTER_COLORS.length],
            opacity: 0.65,
            shadowBlur: 5,
            shadowColor: CLUSTER_COLORS[i % CLUSTER_COLORS.length]
          },
          emphasis: {
            itemStyle: {
              opacity: 1,
              symbolSize: 11
            }
          }
        });
      });

      // Plot the centroids as large golden diamonds with glowing halo
      const centroidsList = km.centroids.map((c, i) => {
        const x = c.length > dimX ? c[dimX] : 0;
        const y = c.length > dimY ? c[dimY] : 0;
        return {
          value: [x, y],
          index: i,
          fullVector: c
        };
      });

      series.push({
        name: 'Index Centroids (IVF)',
        type: 'scatter',
        symbol: 'diamond',
        symbolSize: 14,
        data: centroidsList,
        itemStyle: {
          color: '#fbbf24', // Gold yellow
          borderColor: '#ffffff',
          borderWidth: 1.5,
          shadowBlur: 15,
          shadowColor: '#fbbf24'
        },
        zlevel: 8
      });

      // Plot spoke lines from each node to its assigned centroid
      const centroidSpokes = [];
      km.assignments.forEach((clusterId, idx) => {
        if (clusterId !== -1 && clusterId < km.centroids.length) {
          const v = vectors[idx];
          const x = v.vector && v.vector.length > dimX ? v.vector[dimX] : 0;
          const y = v.vector && v.vector.length > dimY ? v.vector[dimY] : 0;
          
          const c = km.centroids[clusterId];
          const cx = c.length > dimX ? c[dimX] : 0;
          const cy = c.length > dimY ? c[dimY] : 0;
          
          centroidSpokes.push({
            coords: [
              [x, y],
              [cx, cy]
            ]
          });
        }
      });

      series.push({
        name: 'Centroid Links',
        type: 'lines',
        coordinateSystem: 'cartesian2d',
        data: centroidSpokes,
        lineStyle: {
          color: 'rgba(251, 191, 36, 0.12)', // Faint gold spoke
          width: 1.2,
          type: 'dotted',
          curveness: 0
        },
        silent: true,
        zlevel: 1
      });

    } else {
      // Normal display without index partition: Plot all dataset vectors in standard primary blue
      const pointsData = vectors.map(v => {
        const x = v.vector && v.vector.length > dimX ? v.vector[dimX] : 0;
        const y = v.vector && v.vector.length > dimY ? v.vector[dimY] : 0;
        return {
          value: [x, y],
          id: v.id,
          tag: v.tag,
          fullVector: v.vector
        };
      });

      series.push({
        name: 'Dataset Vectors',
        type: 'scatter',
        symbolSize: 8,
        data: pointsData,
        itemStyle: {
          color: '#3b82f6',
          opacity: 0.65,
          shadowBlur: 5,
          shadowColor: 'rgba(59, 130, 246, 0.4)'
        },
        emphasis: {
          itemStyle: {
            color: '#60a5fa',
            opacity: 1,
            symbolSize: 11
          }
        }
      });
    }

    // 2. Plot Nearest Neighbors if they exist
    let neighborPoints = [];
    if (nearestNeighbors && nearestNeighbors.length > 0) {
      neighborPoints = nearestNeighbors.map(n => {
        const x = n.vector && n.vector.length > dimX ? n.vector[dimX] : 0;
        const y = n.vector && n.vector.length > dimY ? n.vector[dimY] : 0;
        return {
          value: [x, y],
          id: n.id,
          tag: n.tag,
          distance: n.distance,
          fullVector: n.vector
        };
      });

      series.push({
        name: 'Nearest Neighbors',
        type: 'scatter',
        symbolSize: 12,
        data: neighborPoints,
        itemStyle: {
          color: '#10b981', // Green
          shadowBlur: 12,
          shadowColor: '#10b981'
        },
        zlevel: 10
      });

      // 3. Draw lines from Target Vector to Nearest Neighbors (with animation and distance label)
      if (targetVector && targetVector.length > 0) {
        const targetX = targetVector.length > dimX ? targetVector[dimX] : 0;
        const targetY = targetVector.length > dimY ? targetVector[dimY] : 0;

        const linesData = neighborPoints.map(n => ({
          coords: [
            [targetX, targetY],
            n.value
          ],
          distanceLabel: `d: ${parseFloat(n.distance).toFixed(3)}`
        }));

        // Base dashed lines with labels
        series.push({
          name: 'Distance Links',
          type: 'lines',
          coordinateSystem: 'cartesian2d',
          data: linesData,
          lineStyle: {
            color: 'rgba(16, 185, 129, 0.35)',
            width: 1.5,
            type: 'dashed',
            curveness: 0
          },
          label: {
            show: true,
            position: 'middle',
            formatter: (params) => params.data.distanceLabel || '',
            fontSize: 10,
            fontFamily: 'monospace',
            fontWeight: 'bold',
            color: '#34d399',
            backgroundColor: 'rgba(11, 15, 25, 0.9)',
            padding: [3, 6],
            borderRadius: 6,
            borderColor: 'rgba(16, 185, 129, 0.5)',
            borderWidth: 1,
            shadowBlur: 8,
            shadowColor: 'rgba(16, 185, 129, 0.3)'
          },
          zlevel: 4
        });

        // Overlay dynamic fast-moving arrow particles
        series.push({
          name: 'Distance Link Flow',
          type: 'lines',
          coordinateSystem: 'cartesian2d',
          data: linesData,
          lineStyle: {
            color: 'rgba(16, 185, 129, 0.8)',
            width: 2.2,
            opacity: 0.6,
            curveness: 0
          },
          effect: {
            show: true,
            period: 2.5,
            trailLength: 0.22,
            symbol: 'arrow',
            symbolSize: 6.5,
            color: '#10b981',
            loop: true
          },
          zlevel: 5
        });
      }
    }

    // 4. Plot Target Vector if it exists
    if (targetVector && targetVector.length > 0) {
      const targetX = targetVector.length > dimX ? targetVector[dimX] : 0;
      const targetY = targetVector.length > dimY ? targetVector[dimY] : 0;

      series.push({
        name: 'Search Target',
        type: 'scatter',
        symbol: 'pin',
        symbolSize: 22,
        data: [{
          value: [targetX, targetY],
          fullVector: targetVector
        }],
        itemStyle: {
          color: '#ef4444', // Red pin
          shadowBlur: 12,
          shadowColor: '#ef4444'
        },
        zlevel: 12
      });
    }

    const option = {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: function (params) {
          if (params.seriesName === 'Search Target') {
            return `Target Vector<br/>[${params.data.value.map(val => val.toFixed(3)).join(', ')}]`;
          }
          if (params.seriesName === 'Distance Links') {
            return null;
          }
          if (params.seriesName === 'Index Centroids (IVF)') {
            return `Index Centroid #${params.data.index}<br/>[${params.data.fullVector.map(val => val.toFixed(3)).join(', ')}]`;
          }
          if (params.seriesName === 'Nearest Neighbors') {
            return `Neighbor Node<br/>ID: <b>${params.data.id}</b><br/>Tag: <b>${params.data.tag}</b><br/>Distance: <b>${parseFloat(params.data.distance).toFixed(4)}</b><br/>Vector: [${params.data.fullVector.join(', ')}]`;
          }
          return `Node<br/>ID: <b>${params.data.id}</b><br/>Tag: <b>${params.data.tag}</b><br/>Vector: [${params.data.fullVector.join(', ')}]`;
        }
      },
      legend: {
        bottom: 5,
        textStyle: { color: '#94a3b8', fontSize: 10 },
        itemGap: 10
      },
      grid: {
        left: '6%',
        right: '6%',
        bottom: '16%',
        top: '6%',
        containLabel: true
      },
      xAxis: {
        type: 'value',
        name: `Dimension ${dimX}`,
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
        axisLabel: { color: '#64748b', fontSize: 10 }
      },
      yAxis: {
        type: 'value',
        name: `Dimension ${dimY}`,
        nameLocation: 'middle',
        nameGap: 25,
        nameTextStyle: { color: '#64748b', fontSize: 10 },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.03)' } },
        axisLabel: { color: '#64748b', fontSize: 10 }
      },
      series: series
    };

    chartInstance.setOption(option);

    const handleResize = () => {
      chartInstance.resize();
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chartInstance.dispose();
    };
  }, [vectors, targetVector, nearestNeighbors, dimX, dimY, tableIndexes]);

  return <div ref={chartRef} style={{ width: '100%', height: '100%' }} />;
};

export default VectorVisualization;
