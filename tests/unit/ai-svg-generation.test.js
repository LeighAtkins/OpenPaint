/**
 * AI SVG Generation Tests
 * Tests for mock AI Worker SVG generation
 */

import { MockAIWorker } from '../../js/ai-worker-mock.js';

describe('AI SVG Generation', () => {
    let mockWorker;
    
    beforeEach(() => {
        mockWorker = new MockAIWorker();
    });
    
    test('generates valid SVG with viewBox', async () => {
        const input = {
            image: { width: 800, height: 600 },
            units: { name: 'cm', pxPerUnit: 37.8 },
            strokes: [{
                id: 'A1',
                type: 'straight',
                points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
                color: '#000000',
                width: 2
            }]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.svg).toContain('viewBox="0 0 800 600"');
        expect(result.svg).toContain('<svg');
        expect(result.svg).toContain('</svg>');
        expect(result.vectors).toHaveLength(1);
    });
    
    test('generates line elements for straight strokes', async () => {
        const input = {
            image: { width: 800, height: 600 },
            strokes: [{
                id: 'A1',
                type: 'straight',
                points: [{ x: 10, y: 20 }, { x: 100, y: 200 }],
                color: '#3b82f6',
                width: 3
            }]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.svg).toContain('<line');
        expect(result.svg).toContain('x1="10');
        expect(result.svg).toContain('y1="20');
        expect(result.svg).toContain('x2="100');
        expect(result.svg).toContain('y2="200');
        expect(result.svg).toContain('stroke="#3b82f6"');
    });
    
    test('adds arrow markers for arrow strokes', async () => {
        const input = {
            image: { width: 800, height: 600 },
            strokes: [{
                id: 'A1',
                type: 'arrow',
                points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
                color: '#000000',
                width: 2
            }]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.svg).toContain('marker-end="url(#arrow-end)"');
        expect(result.svg).toContain('<marker id="arrow-end"');
        expect(result.vectors[0].style.marker).toBe('arrow');
    });
    
    test('generates measurement labels when units provided', async () => {
        const input = {
            image: { width: 800, height: 600 },
            units: { name: 'cm', pxPerUnit: 37.8 },
            strokes: [{
                id: 'A1',
                type: 'straight',
                points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
                color: '#000000',
                width: 2
            }]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.svg).toContain('<text');
        expect(result.svg).toContain('cm');
        expect(result.vectors[0].label).toBeDefined();
        expect(result.vectors[0].label.text).toContain('cm');
        expect(result.summary.measurements).toHaveLength(1);
    });
    
    test('handles multiple strokes', async () => {
        const input = {
            image: { width: 800, height: 600 },
            strokes: [
                {
                    id: 'A1',
                    type: 'straight',
                    points: [{ x: 0, y: 0 }, { x: 100, y: 100 }],
                    color: '#000000',
                    width: 2
                },
                {
                    id: 'A2',
                    type: 'freehand',
                    points: [{ x: 200, y: 200 }, { x: 250, y: 250 }, { x: 300, y: 200 }],
                    color: '#ff0000',
                    width: 3
                }
            ]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.vectors).toHaveLength(2);
        expect(result.vectors[0].id).toBe('A1');
        expect(result.vectors[1].id).toBe('A2');
        expect(result.summary.counts.lines).toBeGreaterThanOrEqual(1);
    });
    
    test('simplifies freehand paths', async () => {
        const input = {
            image: { width: 800, height: 600 },
            strokes: [{
                id: 'A1',
                type: 'freehand',
                points: Array.from({ length: 100 }, (_, i) => ({ x: i, y: i })),
                color: '#000000',
                width: 2
            }]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        // Simplified path should have fewer points than original
        expect(result.vectors[0].points.length).toBeLessThan(100);
        expect(result.vectors[0].points.length).toBeGreaterThan(2);
    });
    
    test('returns proper summary counts', async () => {
        const input = {
            image: { width: 800, height: 600 },
            units: { name: 'cm', pxPerUnit: 37.8 },
            strokes: [
                { id: 'A1', type: 'straight', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: '#000', width: 2 },
                { id: 'A2', type: 'arrow', points: [{ x: 0, y: 100 }, { x: 100, y: 100 }], color: '#000', width: 2 },
                { id: 'A3', type: 'freehand', points: [{ x: 0, y: 200 }, { x: 50, y: 250 }], color: '#000', width: 2 }
            ]
        };
        
        const result = await mockWorker.generateSVG(input);
        
        expect(result.summary.counts.lines).toBe(2);
        expect(result.summary.counts.arrows).toBe(1);
        expect(result.summary.measurements).toHaveLength(2);
    });
});

describe('Assist Measurement', () => {
    let mockWorker;
    
    beforeEach(() => {
        mockWorker = new MockAIWorker();
    });
    
    test('calculates measurement value correctly', async () => {
        const input = {
            units: { name: 'cm', pxPerUnit: 37.8 },
            stroke: {
                id: 'A1',
                type: 'straight',
                points: [{ x: 0, y: 0 }, { x: 378, y: 0 }], // 10 cm
                color: '#000',
                width: 2
            }
        };
        
        const result = await mockWorker.assistMeasurement(input);
        
        expect(result.value).toBeCloseTo(10, 1);
        expect(result.formatted).toContain('10');
        expect(result.formatted).toContain('cm');
        expect(result.labelPos).toBeDefined();
        expect(result.fontSize).toBeGreaterThan(0);
    });
    
    test('suggests label position', async () => {
        const input = {
            units: { name: 'in', pxPerUnit: 96 },
            stroke: {
                id: 'A1',
                type: 'straight',
                points: [{ x: 100, y: 100 }, { x: 200, y: 200 }],
                color: '#000',
                width: 2
            }
        };
        
        const result = await mockWorker.assistMeasurement(input);
        
        expect(result.labelPos.x).toBeGreaterThan(0);
        expect(result.labelPos.y).toBeGreaterThan(0);
    });
});

