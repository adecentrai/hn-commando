/*
    HN Commando - Effects
    - Particle effects, some persistent (debris sticks to the terrain)
    - Destroys terrain and makes explosions
    - Parallax mountains and a starfield sky
    - zzfx sound effects
    Based on the LittleJS platformer example (MIT, Frank Force)
*/

'use strict';

import * as LJS from './littlejs.esm.min.js';
import * as GameLevel from './gameLevel.js';
const {vec2, hsl} = LJS;

///////////////////////////////////////////////////////////////////////////////
// sound effects

export const sound_shoot =        new LJS.Sound([,,90,,.01,.03,4,,,,,,,9,50,.2,,.2,.01]);
export const sound_enemyShoot =   new LJS.Sound([.6,,300,,.01,.05,2,,-9,,,,,4,20,.1,,.3]);
export const sound_destroyObject =new LJS.Sound([.5,,1e3,.02,,.2,1,3,.1,,,,,1,-30,.5,,.5]);
export const sound_die =          new LJS.Sound([.5,.4,126,.05,,.2,1,2.09,,-4,,,1,1,1,.4,.03]);
export const sound_jump =         new LJS.Sound([.4,.2,250,.04,,.04,,,1,,,,,3]);
export const sound_dodge =        new LJS.Sound([.4,.2,150,.05,,.05,,,-1,,,,,4,,,,,.02]);
export const sound_walk =         new LJS.Sound([.3,.1,50,.005,,.01,4,,,,,,,,10,,,.5]);
export const sound_explosion =    new LJS.Sound([2,.2,72,.01,.01,.2,4,,,,,,,1,,.5,.1,.5,.02]);
export const sound_grenade =      new LJS.Sound([.5,.01,300,,,.02,3,.22,,,-9,.2,,,,,,.5]);
export const sound_score =        new LJS.Sound([,,783,,.03,.02,1,2,,,940,.03,,,,,.2,.6,,.06]);
export const sound_pickup =       new LJS.Sound([,,537,.02,.02,.22,1,1.59,-6.98,4.97]);
export const sound_mission =      new LJS.Sound([1.5,,262,.04,.3,.5,1,.3,,,262,.1,.1,,,,.1,.6,.2]);
export const sound_spawn =        new LJS.Sound([,,400,.05,.2,.3,,1.5,,,200,.05,.1]);

// play a sound at most once per gap, so dozens of hits in one moment don't pile up voices
const soundLastPlayed = new Map;
export function playSound(sound, pos, gap=.04)
{
    const now = performance.now();
    if (now - (soundLastPlayed.get(sound) || 0) < gap*1e3)
        return;
    soundLastPlayed.set(sound, now);
    sound.play(pos);
}

///////////////////////////////////////////////////////////////////////////////
// terrain changes are batched and drawn in one GPU pass per frame
// (every separate layer draw is a render target switch, very slow on phones)

const changedTiles = new Map;  // "x,y" -> cell to redraw with its outline
const debrisStamps = [];       // landed debris waiting to be painted onto the terrain
const maxStampsPerFrame = 150, maxStampsQueued = 600;

export function resetTerrainChanges()
{
    changedTiles.clear();
    debrisStamps.length = 0;
}

function markTileChanged(pos)
{
    for (let i=-1; i<=1; ++i)
    for (let j=-1; j<=1; ++j)
    {
        const p = vec2(pos.x+i, pos.y+j);
        changedTiles.set(p.x + ',' + p.y, p);
    }
}

export function flushTerrainChanges()
{
    if (!changedTiles.size && !debrisStamps.length)
        return;

    const layer = GameLevel.foregroundTileLayer;
    layer.redrawStart();
    for (const pos of changedTiles.values())
    {
        if (pos.x < 0 || pos.y < 0 || pos.x >= GameLevel.levelSize.x || pos.y >= GameLevel.levelSize.y)
            continue;
        layer.drawTileData(pos, true); // clears the cell first
        GameLevel.decorateTile(pos, layer, true);
    }
    changedTiles.clear();

    // paint landed debris, layer pixels are world units * 16 with the layer at the origin
    for (const s of debrisStamps.splice(0, maxStampsPerFrame))
        layer.drawLayerRect(s.pos.scale(16).subtract(s.size.scale(8)), s.size.scale(16), s.color, s.angle);
    layer.redrawEnd();
}

///////////////////////////////////////////////////////////////////////////////
// special effects

export const persistentParticleDestroyCallback = (particle)=>
{
    // queue particle to be drawn into the tile layer
    LJS.ASSERT(!particle.tileInfo, 'quick draw to tile layer uses canvas 2d so must be untextured');
    if (particle.groundObject && debrisStamps.length < maxStampsQueued)
        debrisStamps.push({pos: particle.pos.copy(), size: particle.size.copy(), color: particle.color.copy(), angle: particle.angle});
}

export function makeBlood(pos, amount, color=hsl(0,1,.5)) { makeDebris(pos, color, amount, .1, 0); }
export function makeDebris(pos, color = hsl(), amount = 50, size=.2, restitution = .3)
{
    const color2 = color.lerp(hsl(), .5);
    const emitter = new LJS.ParticleEmitter(
        pos, 0, .5, .1, amount/.1, 3.14, // pos, angle, size, time, rate, cone
        0,                     // tileInfo
        color, color2,         // colorStartA, colorStartB
        color, color2,         // colorEndA, colorEndB
        3, size,size, .1, .05, // time, sizeStart, sizeEnd, speed, angleSpeed
        1, .95, .4, 3.14, 0,   // damp, angleDamp, gravity, particleCone, fade
        .5, 1                  // randomness, collide
    );
    emitter.restitution = restitution;
    emitter.particleDestroyCallback = persistentParticleDestroyCallback;
    return emitter;
}

///////////////////////////////////////////////////////////////////////////////

// sparedTeam takes no damage, e.g. a destroyed turret's blast spares the player who shot it
export function explosion(pos, radius=3, sparedTeam='')
{
    LJS.ASSERT(radius > 0);

    sound_explosion.play(pos);

    // destroy level, the redraw happens in the next terrain flush
    for (let x = -radius; x < radius; ++x)
    {
        const h = (radius*radius - x*x)**.5;
        for (let y = -h; y <= h; ++y)
            destroyTile(pos.add(vec2(x,y)), 0);
    }

    // kill/push objects
    LJS.engineObjectsCallback(pos, radius*6, (o)=>
    {
        const damage = radius*2;
        const d = o.pos.distance(pos);
        if (o.isGameObject && !(sparedTeam && o.team == sparedTeam))
        {
            // do damage
            d < radius && o.damage(damage);
        }

        // push
        const p = LJS.percent(d, 2*radius, radius);
        const force = o.pos.subtract(pos).normalize(p*radius*.2);
        o.applyForce(force);
    });

    // smoke
    new LJS.ParticleEmitter(
        pos, 0,                       // pos, angle
        radius/2, .2, 50*radius, 3.14,// emitSize, emitTime, rate, cone
        0,                            // tileInfo
        hsl(0,0,0), hsl(0,0,0),       // colorStartA, colorStartB
        hsl(0,0,0,0), hsl(0,0,0,0),   // colorEndA, colorEndB
        1, .5, 2, .2, .05,    // time, sizeStart, sizeEnd, speed, angleSpeed
        .9, 1, -.3, 3.14, .1, // damp, angleDamp, gravity, particleCone, fade
        .5, 0, 0, 0, 1e8      // randomness, collide, additive, colorLinear, renderOrder
    );

    // fire
    new LJS.ParticleEmitter(
        pos, 0,                         // pos, angle
        radius/2, .1, 100*radius, 3.14, // emitSize, emitTime, rate, cone
        0,                              // tileInfo
        hsl(.07,1,.55),   hsl(0,1,.55),   // colorStartA, colorStartB
        hsl(.07,1,.55,0), hsl(0,1,.55,0), // colorEndA, colorEndB
        .7, .8, .2, .2, .05,   // time, sizeStart, sizeEnd, speed, angleSpeed
        .9, 1, -.2, 3.14, .05, // damp, angleDamp, gravity, particleCone, fade
        .5, 0, 1, 0, 1e9       // randomness, collide, additive, colorLinear, renderOrder
    );
}

///////////////////////////////////////////////////////////////////////////////

export function destroyTile(pos, makeSound = 1)
{
    // pos must be an int
    pos = pos.floor();

    // destroy tile
    const layer = GameLevel.foregroundTileLayer;
    const tileType = layer.getCollisionData(pos);
    if (!tileType)
        return true;

    const centerPos = pos.add(vec2(.5));
    const layerData = layer.getData(pos);
    if (!layerData || tileType == GameLevel.tileType_solid)
        return false;

    // create effects
    makeDebris(centerPos, layerData.color.mutate());
    makeSound && playSound(sound_destroyObject, centerPos);

    // clear the tile now, the cell and its neighbours' outlines redraw in the next flush
    layer.clearData(pos);
    layer.setCollisionData(pos, GameLevel.tileType_empty);
    markTileChanged(pos);
    return true;
}

///////////////////////////////////////////////////////////////////////////////
// sky with background gradient and stars

export class Sky extends LJS.EngineObject
{
    constructor()
    {
        super();

        this.renderOrder = -1e4;
        this.seed = LJS.randInt(1e9);
        this.skyColor = LJS.randColor(hsl(0,0,.5), hsl(0,0,.9));
        this.horizonColor = this.skyColor.subtract(hsl(0,0,.05,0)).mutate(.3);
    }

    render()
    {
        // fill background with a gradient
        const canvas = LJS.mainCanvas;
        LJS.drawRectGradient(LJS.cameraPos, LJS.getCameraSize(), this.skyColor, this.horizonColor);

        // draw stars
        LJS.setAdditiveBlendMode();
        const random = new LJS.RandomGenerator(this.seed);
        for (let i = LJS.isTouchDevice ? 350 : 1e3; i--;)
        {
            const size = random.float(.5,2)**2;
            const speed = random.float() < .9 ? random.float(5) : random.float(9,99);
            const color = hsl(random.float(-.3,.2), random.float(), random.float());
            const extraSpace = 50;
            const w = canvas.width+2*extraSpace, h = canvas.height+2*extraSpace;
            const screenPos = vec2(
                (random.float(w)+LJS.time*speed)%w-extraSpace,
                (random.float(h)+LJS.time*speed*random.float())%h-extraSpace);
            LJS.drawRect(screenPos, vec2(size), color, 0, undefined, true)
        }
        LJS.setAdditiveBlendMode(false);
    }
}

///////////////////////////////////////////////////////////////////////////////
// parallax background mountain ranges

export class ParallaxLayer extends LJS.CanvasLayer
{
    constructor(pos, topColor, bottomColor, depth)
    {
        const renderOrder = depth - 3e3;
        const canvasSize = vec2(512, 256);
        super(pos, vec2(), 0, renderOrder, canvasSize);
        this.centerPos = pos;
        this.depth = depth;

        // create a gradient for the mountains
        const w = canvasSize.x, h = canvasSize.y;
        for (let i = h; i--;)
        {
            // draw a 1 pixel gradient line on the left side of the canvas
            const p = i/h;
            this.context.fillStyle = topColor.lerp(bottomColor, p);
            this.context.fillRect(0, i, 1, 1);
        }

        // draw random mountains
        const pointiness = .2;  // how pointy the mountains are
        const levelness = .005; // how much the mountains level out
        const slopeRange = 1;   // max slope of the mountains
        const startGroundLevel = h/2;
        let y = startGroundLevel, groundSlope = LJS.rand(-slopeRange, slopeRange);
        for (let x=w; x--;)
        {
            // pull slope towards start ground level
            y += groundSlope -= (y-startGroundLevel)*levelness;

            // randomly change slope
            if (LJS.rand() < pointiness)
                groundSlope = LJS.rand(-slopeRange, slopeRange);

            // draw 1 pixel wide vertical slice of mountain
            this.context.drawImage(this.canvas, 0, 0, 1, h, x, y, 1, h - y);
        }

        // remove gradient sliver from left side
        this.context.clearRect(0,0,1,h);

        // make WebGL texture
        this.updateWebGL();
    }

    render()
    {
        const canvasSize = vec2(this.canvas.width, this.canvas.height);
        const depth = this.depth
        const distance = 4 + depth;
        const parallax = vec2(150, 30).scale(depth**2+1);
        const levelCenter = this.centerPos;
        const cameraDeltaFromCenter = LJS.cameraPos.subtract(levelCenter)
            .divide(levelCenter.scale(-1).divide(parallax));
        const scale = distance/LJS.cameraScale;
        const positionOffset = vec2(0, 2-depth);
        const cameraOffset = cameraDeltaFromCenter.scale(1/LJS.cameraScale);
        this.pos = LJS.cameraPos.add(positionOffset).add(cameraOffset);
        this.size = canvasSize.scale(scale);
        super.render();
    }
}
