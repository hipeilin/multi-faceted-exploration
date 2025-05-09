// Categories and matching colors
const categories = [
    'unresolved',
    'credit_collection',
    'paid_full',
    'dismissed'
];
const colorScale = d3.scaleOrdinal()
    .domain(categories)
    .range([
        '#e41a1c',
        '#984ea3',
        '#4daf4a',
        '#377eb8'
    ]);



/**
 * Configuration object with default settings
 */
const DEFAULT_CONFIG = {
    pointSize: 3,
    pointOpacity: 0.8,
    margin: { top: 20, right: 20, bottom: 40, left: 50 },
    colorScheme: d3.schemeTableau10,
    defaultHeight: 600,
    minZoom: 0.9,
    maxZoom: 80,
    hoverRadius: 12,
    hoverCircleRadius: 6,
    legendPosition: { x: 0, y: 0 },
    showAxes: false
};

/**
 * Loads data from a CSV file and prepares it for visualization
 * @returns {Promise<Array>} Parsed and processed data
 */
async function loadData() {
    try {
        const response = await fetch('data/data_preprocessed.csv');
        if (!response.ok) {
            throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
        }

        const text = await response.text();
        const data = d3.csvParse(text, d => ({
            x: +d['umap-1'],
            y: +d['umap-2'],
            outcome: d['outcome']
        }));

        // Validate data
        if (!data || data.length === 0) {
            throw new Error('CSV parsing resulted in empty dataset');
        }

        // Ensure numeric values
        data.forEach(d => {
            d.x = +d.x;
            d.y = +d.y;

            // Check for NaN values
            if (isNaN(d.x) || isNaN(d.y)) {
                console.warn('Found NaN values in dataset', d);
            }
        });

        return data;
    } catch (err) {
        console.error('Error loading CSV:', err);
        // Display user-friendly error message
        d3.select('#chart')
            .html('<div class="error-message">Failed to load data. Please try again later.</div>');
        throw err;
    }
}

/**
 * Main function to create and render the WebGL scatter plot
 * @param {Array} data - The dataset to visualize
 * @param {Object} userConfig - Optional user configuration to override defaults
 */
function drawScatterPlotWebGL(data, userConfig = {}) {
    // Merge default config with user-provided config
    const config = { ...DEFAULT_CONFIG, ...userConfig };

    // Setup container and clear previous content
    const container = d3.select('#chart');
    container.style('position', 'relative').selectAll('*').remove();

    // ───────────────────────────────────────────
    // Calculate dimensions
    const totalWidth = container.node().clientWidth;
    const totalHeight = container.node().clientHeight || config.defaultHeight;
    const { margin } = config;
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;

    // ───────────────────────────────────────────
    // Create scales with nice rounded domains for better readability
    const xExtent = d3.extent(data, d => d.x);
    const yExtent = d3.extent(data, d => d.y);

    // Add a small padding to the domains
    const xPadding = (xExtent[1] - xExtent[0]) * 0.05;
    const yPadding = (yExtent[1] - yExtent[0]) * 0.05;

    const x0 = d3.scaleLinear()
        .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
        .range([0, width])
        .nice();

    const y0 = d3.scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .range([height, 0])
        .nice();

    // ───────────────────────────────────────────
    // Create canvas for WebGL rendering
    const canvas = container.append('canvas')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0);

    // ───────────────────────────────────────────
    // Create SVG layer for axes, legend, and interactive elements
    const svg = container.append('svg')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // ───────────────────────────────────────────
    // Create axes (conditionally)

    if (config.showAxes) {
        let xAxisG, yAxisG;

        xAxisG = svg.append('g')
            .attr('class', 'x-axis')
            .attr('transform', `translate(0,${height})`)
            .call(d3.axisBottom(x0));

        yAxisG = svg.append('g')
            .attr('class', 'y-axis')
            .call(d3.axisLeft(y0));
    }

    // ───────────────────────────────────────────
    // Create legend group
    const legendG = svg.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${config.legendPosition.x},${config.legendPosition.y})`);

    // ───────────────────────────────────────────
    // Create tooltip
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(255,255,255,0.9)')
        .style('padding', '8px')
        .style('border', '1px solid #aaa')
        .style('border-radius', '4px')
        .style('pointer-events', 'none')
        .style('box-shadow', '0 2px 4px rgba(0,0,0,0.2)')
        .style('font-size', '12px')
        .style('opacity', 1)  // Change from display:none to opacity:0 for better transitions
        .style('display', 'none')  // Initially hidden
        .style('z-index', '1000');  // Ensure tooltip appears above other elements

    // ───────────────────────────────────────────
    // Initialize WebGL context with error handling
    let gl;
    try {
        gl = canvas.node().getContext('webgl', { antialias: true });
        if (!gl) {
            throw new Error('WebGL not supported');
        }
    } catch (error) {
        // Fallback to 2D canvas or display error
        container.html(`<div class="error-message">
        WebGL is not supported in your browser. 
        Try using a modern browser or enable WebGL in your settings.
      </div>`);
        console.error('WebGL initialization failed:', error);
        return;
    }

    // Set up WebGL viewport and blend mode
    gl.viewport(0, 0, canvas.node().width, canvas.node().height);
    gl.clearColor(1, 1, 1, 1);  // White background
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // ───────────────────────────────────────────
    // Create and compile shaders with improved error handling
    const vsSource = `
      attribute vec2 a_pos;
      attribute vec4 a_color;
      uniform vec2 u_translate;
      uniform float u_scale;
      uniform vec2 u_margin;
      uniform vec2 u_viewport;
      uniform float u_pointSize;
      varying vec4 v_color;
      
      void main() {
          vec2 scaled = a_pos * u_scale;
          vec2 panned = scaled + u_translate;
          vec2 px = panned + u_margin;
          vec2 ndc = (px / u_viewport) * 2.0 - 1.0;
          gl_Position = vec4(ndc.x, -ndc.y, 0, 1);
          gl_PointSize = u_pointSize;
          v_color = a_color;
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec4 v_color;
      
      void main() {
          vec2 center = gl_PointCoord - vec2(0.5);
          float dist = length(center);
          
          // Better anti-aliasing with smoother falloff
          float alpha = smoothstep(0.5, 0.35, dist) * v_color.a;
          
          // Discard fragments outside the circle
          if (dist > 0.5) discard;
          
          // Premultiply alpha for proper blending
          gl_FragColor = vec4(v_color.rgb * alpha, alpha);
      }
    `;

    /**
     * Compiles a WebGL shader with better error reporting
     * @param {string} src - Shader source code
     * @param {number} type - Shader type (VERTEX_SHADER or FRAGMENT_SHADER)
     * @returns {WebGLShader} Compiled shader
     */
    function compileShader(src, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, src);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            const shaderType = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
            const errorLines = src.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
            throw new Error(`Could not compile ${shaderType} shader:\n${info}\n\nShader source:\n${errorLines}`);
        }

        return shader;
    }

    // Create and link the WebGL program
    let program;
    try {
        program = gl.createProgram();
        gl.attachShader(program, compileShader(vsSource, gl.VERTEX_SHADER));
        gl.attachShader(program, compileShader(fsSource, gl.FRAGMENT_SHADER));
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(`Could not link WebGL program: ${gl.getProgramInfoLog(program)}`);
        }

        gl.useProgram(program);
    } catch (error) {
        console.error('Shader compilation error:', error);
        container.html(`<div class="error-message">
        Failed to initialize WebGL shaders. Please try again with a different browser.
      </div>`);
        return;
    }

    // ───────────────────────────────────────────
    // Create position and color buffers
    const N = data.length;

    // Create position buffer
    const positions = new Float32Array(N * 2);
    data.forEach((d, i) => {
        positions[2 * i] = x0(d.x);
        positions[2 * i + 1] = y0(d.y);
    });

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // Create color buffer based on categorical outcome
    const outcomes = Array.from(new Set(data.map(d => d.outcome)));
    const colorScale = d3.scaleOrdinal(outcomes, config.colorScheme);

    const colorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);

    const colors = new Float32Array(N * 4);
    data.forEach((d, i) => {
        const c = d3.color(colorScale(d.outcome));
        colors.set([c.r / 255, c.g / 255, c.b / 255, config.pointOpacity], 4 * i);
    });
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    // ───────────────────────────────────────────
    // Set up WebGL attributes and uniforms

    // Position attribute
    const aPosLoc = gl.getAttribLocation(program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    // Color attribute
    const aColLoc = gl.getAttribLocation(program, 'a_color');
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(aColLoc);
    gl.vertexAttribPointer(aColLoc, 4, gl.FLOAT, false, 0, 0);

    // Set up uniform locations
    const uTransLoc = gl.getUniformLocation(program, 'u_translate');
    const uScaleLoc = gl.getUniformLocation(program, 'u_scale');
    const uViewLoc = gl.getUniformLocation(program, 'u_viewport');
    const uMarginLoc = gl.getUniformLocation(program, 'u_margin');
    const uPointSizeLoc = gl.getUniformLocation(program, 'u_pointSize');

    // Set initial uniform values
    gl.uniform2f(uMarginLoc, margin.left, margin.top);
    gl.uniform2f(uViewLoc, totalWidth, totalHeight);
    gl.uniform1f(uPointSizeLoc, config.pointSize);

    // ───────────────────────────────────────────
    // Render function with current transform state
    let currentTransform = d3.zoomIdentity;

    /**
     * Renders the WebGL scatter plot with current transform
     */
    function renderGL() {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uTransLoc, currentTransform.x, currentTransform.y);
        gl.uniform1f(uScaleLoc, currentTransform.k);
        gl.drawArrays(gl.POINTS, 0, N);
    }

    // Initial render
    renderGL();

    // ───────────────────────────────────────────
    // Efficient nearest point lookup with early bailout

    /**
     * Finds the nearest data point to the given mouse position
     * @param {number} mx - Mouse X position (in transformed coordinates)
     * @param {number} my - Mouse Y position (in transformed coordinates)
     * @param {number} threshold - Maximum distance to consider (in pixels)
     * @returns {Object|null} Nearest data point or null if none within threshold
     */
    function findNearest(mx, my, threshold = config.hoverRadius) {
        // Ensure we have valid coordinates
        if (isNaN(mx) || isNaN(my)) {
            console.warn('Invalid coordinates for findNearest:', mx, my);
            return null;
        }
        let minD2 = Infinity;
        let best = null;
        const thresholdSquared = threshold * threshold;

        // For large datasets, consider implementing a spatial index
        // like a quadtree for better performance
        for (let i = 0; i < N; i++) {
            const px = positions[2 * i] * currentTransform.k + currentTransform.x;
            const py = positions[2 * i + 1] * currentTransform.k + currentTransform.y;
            const dx = px - mx;
            const dy = py - my;
            const d2 = dx * dx + dy * dy;

            // Early bailout if we're far from the point
            if (d2 > thresholdSquared) continue;

            if (d2 < minD2) {
                minD2 = d2;
                best = data[i];
            }
        }

        return best;
    }

    // ───────────────────────────────────────────
    // Create hover indicator layer
    const hoverLayer = container.append('svg')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .style('pointer-events', 'none')
        .append('g')
        .attr('class', 'hover-layer');

    // Create hover indicator circle
    const hoverDot = hoverLayer.append('circle')
        .attr('r', config.hoverCircleRadius)
        .attr('stroke', 'black')
        .attr('stroke-width', 1.5)
        .attr('fill', 'none')
        .style('pointer-events', 'none')
        .style('display', 'none');

    // ───────────────────────────────────────────
    // Draw legend with better styling
    outcomes.forEach((outcome, i) => {
        const row = legendG.append('g')
            .attr('transform', `translate(0, ${i * 20})`)
            .attr('class', 'legend-item');

        // Legend color box
        row.append('rect')
            .attr('width', 12)
            .attr('height', 12)
            .attr('rx', 2)
            .attr('ry', 2)
            .attr('fill', colorScale(outcome));

        // Legend text
        row.append('text')
            .attr('x', 16)
            .attr('y', 10)
            .attr('font-size', '12px')
            .attr('alignment-baseline', 'middle')
            .text(outcome);
    });

    // ───────────────────────────────────────────
    // Create transparent rectangle to capture mouse events
    const zoomRect = svg.append('rect')
        .attr('width', width)
        .attr('height', height)
        .style('fill', 'none')
        .style('pointer-events', 'all');

    // ───────────────────────────────────────────
    // Add zoom and hover behavior
    zoomRect
        .on('mousemove', (event) => {
            const [mx, my] = d3.pointer(event); // relative to the <g> (already margin-translated)
            const d = findNearest(mx, my);

            if (!d) {
                hoverDot.style('display', 'none');
                tooltip.style('display', 'none');
                return;
            }

            // Calculate screen coordinates with current transform
            const xScreen = margin.left + (x0(d.x) * currentTransform.k + currentTransform.x);
            const yScreen = margin.top + (y0(d.y) * currentTransform.k + currentTransform.y);

            // Show hover indicator
            hoverDot
                .attr('cx', xScreen)
                .attr('cy', yScreen)
                .style('display', '');

            // Show tooltip with formatted information
            tooltip
                .html(`
            <div><strong>Outcome:</strong> ${d.outcome}</div>
          `)
                .style('left', `${event.pageX + 10}px`)
                .style('top', `${event.pageY - 28}px`)
                .style('display', '')
        })
        .on('mouseout', function () {
            // Hide hover indicator and tooltip when mouse leaves
            hoverDot.style('display', 'none');
            tooltip.style('display', 'none');
        })
        .call(d3.zoom()
            .scaleExtent([config.minZoom, config.maxZoom])
            .on('zoom', function (event) {
                // Update current transform and re-render
                currentTransform = event.transform;
                renderGL();

                // Update axes if they exist
                if (config.showAxes) {
                    xAxisG.call(d3.axisBottom(event.transform.rescaleX(x0)));
                    yAxisG.call(d3.axisLeft(event.transform.rescaleY(y0)));
                }
            })
        );

    // ───────────────────────────────────────────
    // Handle window resize
    function handleResize() {
        const newWidth = container.node().clientWidth;
        const newHeight = container.node().clientHeight || config.defaultHeight;

        if (newWidth === totalWidth && newHeight === totalHeight) {
            return; // No size change
        }

        // Update canvas and SVG dimensions
        canvas.attr('width', newWidth).attr('height', newHeight);
        svg.attr('width', newWidth).attr('height', newHeight);
        hoverLayer.attr('width', newWidth).attr('height', newHeight);

        // Update WebGL viewport
        gl.viewport(0, 0, newWidth, newHeight);
        gl.uniform2f(uViewLoc, newWidth, newHeight);

        // Re-render
        renderGL();
    }

    // Add resize listener
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container.node());

    // Return cleanup function
    return function cleanup() {
        // Remove event listeners
        resizeObserver.disconnect();

        // Clean up WebGL resources
        gl.deleteBuffer(posBuf);
        gl.deleteBuffer(colorBuf);
        gl.deleteProgram(program);

        // Remove tooltip
        tooltip.remove();
    };
}

/**
 * Initialize the visualization
 */
async function initVisualization() {
    try {
        // Show loading indicator
        d3.select('#chart').html('<div class="loading">Loading data...</div>');

        const data = await loadData();

        // Create the visualization with configurable options
        const cleanup = drawScatterPlotWebGL(data, {
            pointSize: 3.5,
            pointOpacity: 0.75,
            showAxes: false,
            legendPosition: { x: 10, y: 10 }
        });

        // Handle cleanup on page unload
        window.addEventListener('beforeunload', cleanup);

    } catch (error) {
        console.error('Visualization initialization failed:', error);
    }
}

// Initialize on document load
document.addEventListener('DOMContentLoaded', initVisualization);

// async function loadFirstRow() {
//     d3.csv('data/data_preprocessed.csv')
//         .then(rows => {
//             const first = rows[0];

//             const entries = Object.entries(first)
//                 .filter(([key]) => key === 'amount' || key === 'expense' || key === 'totalPaymentAmount' || key === 'outstanding_balance')
//                 .map(([key, val]) => ({ key, value: +val }))
//                 .filter(d => !isNaN(d.value));

//             console.log('entries:', entries);
//             drawBarChart(entries);

//         })
//         .catch(console.error);

// }

// function drawBarChart(data) {
//     const margin = { top: 20, right: 20, bottom: 100, left: 60 };
//     const width = 600 - margin.left - margin.right;
//     const height = 400 - margin.top - margin.bottom;

//     const svg = d3.select('#chart2')
//         .append('svg')
//         .attr('width', width + margin.left + margin.right)
//         .attr('height', height + margin.top + margin.bottom)
//         .append('g')
//         .attr('transform', `translate(${margin.left},${margin.top})`);

//     // X = categories (the keys)
//     const x = d3.scaleBand()
//         .domain(data.map(d => d.key))
//         .range([0, width])
//         .padding(0.1);

//     // Y = linear from 0 → max value
//     const y = d3.scaleLinear()
//         .domain([0, d3.max(data, d => d.value)]).nice()
//         .range([height, 0]);

//     // draw axes
//     svg.append('g')
//         .call(d3.axisLeft(y));
//     svg.append('g')
//         .attr('transform', `translate(0,${height})`)
//         .call(d3.axisBottom(x))
//         .selectAll('text')
//         .attr('transform', 'rotate(-40)')
//         .style('text-anchor', 'end');

//     // draw bars
//     svg.selectAll('.bar')
//         .data(data)
//         .enter().append('rect')
//         .attr('class', 'bar')
//         .attr('x', d => x(d.key))
//         .attr('y', d => y(d.value))
//         .attr('width', x.bandwidth())
//         .attr('height', d => height - y(d.value))
//         .attr('fill', '#69b3a2')
// }


// loadData(); // to draw the scatterplot

// loadFirstRow(); // to draw the bar chart

