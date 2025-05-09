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


async function loadData() {
    try {
        const text = await (await fetch('data/data_preprocessed.csv')).text();
        const data = d3.csvParse(text, d => ({
            x: +d['umap-1'],
            y: +d['umap-2'],
            outcome: d['outcome']
        }));
        drawScatterPlotWebGL(data);

    } catch (err) {
        console.error('Error loading CSV:', err);
    }
}


function drawScatterPlotWebGL(data) {
    const container = d3.select('#chart');
    container.style('position', 'relative').selectAll('*').remove();

    // ───────────────────────────────────────────
    // size 
    const totalWidth = container.node().clientWidth;
    const totalHeight = container.node().clientHeight || 600;
    const margin = { top: 20, right: 20, bottom: 40, left: 50 };
    const width = totalWidth - margin.left - margin.right;
    const height = totalHeight - margin.top - margin.bottom;

    // ───────────────────────────────────────────
    // scales
    data.forEach(d => { d.x = +d.x; d.y = +d.y; });
    const x0 = d3.scaleLinear()
        .domain(d3.extent(data, d => d.x))
        .range([0, width]);
    const y0 = d3.scaleLinear()
        .domain(d3.extent(data, d => d.y))
        .range([height, 0]);

    // ───────────────────────────────────────────
        // canvas for WebGL
    const canvas = container.append('canvas')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0);

    // ───────────────────────────────────────────
        // SVG for axes + hover circle + zoom layer
    const svg = container.append('svg')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0).style('left', 0)
        .append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`);

    // ───────────────────────────────────────────
    // axes
    const xAxisG = svg.append('g')
        .attr('class', 'x axis')
        .attr('transform', `translate(0,${height})`)
        .call(d3.axisBottom(x0));
    const yAxisG = svg.append('g')
        .attr('class', 'y axis')
        .call(d3.axisLeft(y0));


    // ───────────────────────────────────────────
    // tooltip div
    const tooltip = d3.select('body').append('div')
        .attr('class', 'tooltip')
        .style('position', 'absolute')
        .style('background', 'rgba(255,255,255,0.8)')
        .style('padding', '4px 8px')
        .style('border', '1px solid #aaa')
        .style('border-radius', '4px')
        .style('pointer-events', 'none')
        .style('opacity', 1)
        .style('display', 'none')

    // ───────────────────────────────────────────
    // set up WebGL context 
    const gl = canvas.node().getContext('webgl', { antialias: true });
    if (!gl) throw new Error('WebGL not supported');
    gl.viewport(0, 0, canvas.node().width, canvas.node().height);
    gl.clearColor(1, 1, 1, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);


    // ───────────────────────────────────────────
    // shaders 
    const vsSource = `
      attribute vec2 a_pos;
      attribute vec4 a_color;
      uniform vec2 u_translate;
      uniform float u_scale;
      uniform vec2 u_margin;
      uniform vec2 u_viewport;
      varying vec4 v_color;
      void main() {
        vec2 scaled = a_pos * u_scale;
        vec2 panned = scaled + u_translate;
        vec2 px     = panned + u_margin;
        vec2 ndc    = (px / u_viewport) * 2.0 - 1.0;
        gl_Position = vec4(ndc.x, -ndc.y, 0, 1);
        gl_PointSize = 3.0;
        v_color = a_color;
      }
    `;
    const fsSource = `
      precision mediump float;
      varying vec4 v_color;
      void main() {
        gl_FragColor = v_color;
      }
    `;

    function compileShader(src, type) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(gl.getShaderInfoLog(s));
        return s;
    }
    const program = gl.createProgram();
    gl.attachShader(program, compileShader(vsSource, gl.VERTEX_SHADER));
    gl.attachShader(program, compileShader(fsSource, gl.FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(program));
    gl.useProgram(program);

    // ───────────────────────────────────────────
    // build position & color buffers 
    const N = data.length;
    const positions = new Float32Array(N * 2);
    data.forEach((d, i) => {
        positions[2 * i] = x0(d.x);
        positions[2 * i + 1] = y0(d.y);
    });

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // color buffer (optional: encode outcome→color)
    const outcomes = Array.from(new Set(data.map(d => d.outcome)));
    const colorScale = d3.scaleOrdinal(outcomes, d3.schemeTableau10);
    const colorBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    const colors = new Float32Array(N * 4);
    data.forEach((d, i) => {
        const c = d3.color(colorScale(d.outcome));
        colors.set([c.r / 255, c.g / 255, c.b / 255, 0.8], 4 * i);
    });
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);

    // attributes
    const aPosLoc = gl.getAttribLocation(program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.enableVertexAttribArray(aPosLoc);
    gl.vertexAttribPointer(aPosLoc, 2, gl.FLOAT, false, 0, 0);

    const aColLoc = gl.getAttribLocation(program, 'a_color');
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuf);
    gl.enableVertexAttribArray(aColLoc);
    gl.vertexAttribPointer(aColLoc, 4, gl.FLOAT, false, 0, 0);

    // uniforms
    const uTransLoc = gl.getUniformLocation(program, 'u_translate');
    const uScaleLoc = gl.getUniformLocation(program, 'u_scale');
    const uViewLoc = gl.getUniformLocation(program, 'u_viewport');
    const uMarginLoc = gl.getUniformLocation(program, 'u_margin');
    gl.uniform2f(uMarginLoc, margin.left, margin.top);
    gl.uniform2f(uViewLoc, totalWidth, totalHeight);

    // ───────────────────────────────────────────
    // render function 
    let currentTransform = d3.zoomIdentity;
    function renderGL() {
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.uniform2f(uTransLoc, currentTransform.x, currentTransform.y);
        gl.uniform1f(uScaleLoc, currentTransform.k);
        gl.drawArrays(gl.POINTS, 0, N);
    }
    renderGL();

    // ───────────────────────────────────────────
    // hover & zoom wiring 
    // helper: find nearest data point in pixel-space
    function findNearest(mx, my) {
        let minD2 = Infinity, best = null;
        for (let i = 0; i < N; i++) {
            const px = positions[2 * i] * currentTransform.k + currentTransform.x;
            const py = positions[2 * i + 1] * currentTransform.k + currentTransform.y;
            const dx = px - mx, dy = py - my;
            const d2 = dx * dx + dy * dy;
            if (d2 < minD2) minD2 = d2, best = data[i];
        }
        return (Math.sqrt(minD2) < 25 /* 5 px radius² */) ? best : null;
    }

    const hoverLayer = container.append('svg')
        .attr('width', totalWidth)
        .attr('height', totalHeight)
        .style('position', 'absolute')
        .style('top', 0)
        .style('left', 0)
        .style('pointer-events', 'none')
        .append('g')
        .attr('class', 'hover-layer');

    const hoverDot = hoverLayer.append('circle')
        .attr('r', 6)
        .attr('stroke', 'black')
        .attr('fill', 'none')
        .style('pointer-events', 'none')
        .style('display', 'none');

    // ───────────────────────────────────────────
    // transparent rect to capture zoom+pointer
    const zoomRect = svg.append('rect')
        .attr('width', width)
        .attr('height', height)
        .style('fill', 'none')
        .style('pointer-events', 'all');

    zoomRect
        .on('mousemove', (event) => {
            const [mx, my] = d3.pointer(event); // relative to the <g> (already margin-translated)
            const d = findNearest(mx, my);
            if (!d) {
                hoverDot.style('display', 'none');
                tooltip.style('display', 'none');
                return;
            }

            // the transform lives in currentTransform; apply it manually:
            const xScreen = margin.left + (x0(d.x) * currentTransform.k + currentTransform.x);
            const yScreen = margin.top + (y0(d.y) * currentTransform.k + currentTransform.y);

            hoverDot
                .attr('cx', xScreen)
                .attr('cy', yScreen)
                .style('display', '');

            tooltip
                .html(`Outcome: ${d.outcome}`)
                .style('left', (event.pageX + 10) + 'px')
                .style('top', (event.pageY - 28) + 'px')
                .style('display', '')
        })
        .on('mouseout', () => {
            hoverDot.style('display', 'none');
        })
        .call(d3.zoom()
            .scaleExtent([1, 80])
            .on('zoom', (event) => {
                currentTransform = event.transform;
                renderGL();
                xAxisG.call(d3.axisBottom(event.transform.rescaleX(x0)));
                yAxisG.call(d3.axisLeft(event.transform.rescaleY(y0)));
            })
        );
}







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


loadData(); // to draw the scatterplot

// loadFirstRow(); // to draw the bar chart

