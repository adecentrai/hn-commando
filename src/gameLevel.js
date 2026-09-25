/*
    HN Commando - Level Generator
    - Builds a fresh random planet for every mission: hills and cliffs, caves,
      floating islands with ladders, and enemy outposts
    - Picks colors for the level and background
    - Returns where to spawn crates, coins and hostiles
    Tile decoration and camera code from the LittleJS platformer example (MIT, Frank Force)
*/

'use strict';

import * as LJS from './littlejs.esm.min.js';
import * as GameEffects from './gameEffects.js';
import * as Game from './game.js';
const {vec2, hsl, tile} = LJS;

export const tileType_ladder    = -1;
export const tileType_empty     = 0;
export const tileType_solid     = 1;
export const tileType_breakable = 2;

export let playerStartPos, tileLayers, foregroundTileLayer, sky;
export let levelSize, levelColor, levelBackgroundColor, levelOutlineColor;

// tile indexes in tilesLevel.png
const tileGround = 1, tileRock = 2, tileLadder = 3, tileMetal = 4;

export function buildLevel(mission)
{
    // destroy all objects
    LJS.engineObjectsDestroy();

    // create the level
    levelColor = LJS.randColor(hsl(0,0,.2), hsl(0,0,.8));
    levelBackgroundColor = levelColor.mutate().scale(.4,1);
    levelOutlineColor = levelColor.mutate().add(hsl(0,0,.4)).clamp();
    const {map, spawns} = generateLevel(mission);
    loadLevelData(map);
    playerStartPos = spawns.start;

    // create sky object with gradient background and stars
    sky = new GameEffects.Sky;

    // create parallax layers
    for (let i=3; i--;)
    {
        const pos = levelSize.scale(.5);
        const topColor = levelColor.mutate(.2).lerp(sky.skyColor, .8 - i*.15);
        const bottomColor = levelColor.subtract(LJS.CLEAR_WHITE).mutate(.2);
        new GameEffects.ParallaxLayer(pos, topColor, bottomColor, i );
    }
    return spawns;
}

///////////////////////////////////////////////////////////////////////////////
// procedural generation, grids are indexed [x][y] with y=0 at the bottom

function generateLevel(mission)
{
    const W = LJS.min(110 + mission*15, 200), H = 56;
    const makeGrid = ()=> Array.from({length:W}, ()=> new Array(H).fill(0));
    const fg = makeGrid(), bg = makeGrid();
    const inside = (x,y)=> x > 0 && x < W-1 && y > 0 && y < H-1;
    const isSolid = (x,y)=> x >= 0 && x < W && y >= 0 && y < H && fg[x][y] > 0 && fg[x][y] != tileLadder;
    const setTile = (x,y,t)=> { if (inside(x,y)) fg[x][y] = t; };
    const carve = (cx,cy,r)=>
    {
        for (let x = cx-r|0; x <= cx+r; ++x)
        for (let y = cy-r|0; y <= cy+r; ++y)
            if (inside(x,y) && y > 1 && (x-cx)**2 + (y-cy)**2 <= r*r)
                fg[x][y] = 0;
    };

    // surface: layered hills plus sudden cliffs
    const surface = [];
    const base = LJS.rand(14, 20);
    const f1 = LJS.rand(.03,.06), f2 = LJS.rand(.1,.2), p1 = LJS.rand(9), p2 = LJS.rand(9);
    const a1 = LJS.rand(3,7), a2 = LJS.rand(1,3);
    let step = 0;
    for (let x=0; x<W; ++x)
    {
        if (LJS.rand() < .05)
            step = LJS.randInt(-4, 5);
        const h = base + a1*LJS.sin(x*f1+p1) + a2*LJS.sin(x*f2+p2) + step;
        surface[x] = LJS.clamp(LJS.round(h), 6, H-22);
    }
    for (let x=0; x<10; ++x)
        surface[x] = surface[10]; // flat landing zone

    // fill the ground, rock deeper down
    for (let x=0; x<W; ++x)
    for (let y=1; y<=surface[x]; ++y)
    {
        fg[x][y] = y < surface[x] - 3 && LJS.rand() < .6 ? tileRock : tileGround;
        bg[x][y] = tileGround;
    }

    // caves wind through the ground
    for (let i = 2 + LJS.randInt(3); i--;)
    {
        let x = LJS.rand(15, W-10), y = LJS.rand(3, surface[x|0]-3), angle = LJS.rand(9);
        for (let j = LJS.randInt(30, 70); j--;)
        {
            carve(x, y, LJS.rand(1.2, 2.2));
            angle += LJS.rand(-.5, .5);
            x = LJS.clamp(x + LJS.sin(angle), 12, W-3);
            y = LJS.clamp(y + LJS.cos(angle)*.5, 3, surface[x|0]-2);
        }
    }

    // floating islands, many with a ladder up from the ground
    const ladder = (x, fromY, toY)=>
    {
        for (let y = fromY; y <= toY; ++y)
            if (inside(x,y) && fg[x][y] != tileMetal)
                fg[x][y] = tileLadder;
    };
    for (let i = W/16|0; i--;)
    {
        const cx = LJS.randInt(14, W-8);
        const cy = surface[cx] + LJS.randInt(5, 10);
        const w = LJS.randInt(3, 8), h = LJS.randInt(1, 3);
        if (cy > H-6)
            continue;
        const metal = LJS.rand() < .25;
        for (let dx=-w; dx<=w; ++dx)
        for (let dy=-h; dy<=0; ++dy)
            if ((dx/w)**2 + (dy/h)**2 <= 1)
                setTile(cx+dx, cy+dy, metal && !dy ? tileMetal : tileGround);
        if (LJS.rand() < .6)
            ladder(cx, surface[cx]+1, cy);
    }

    // enemy outposts: walled rooms with doors, a ladder to the roof
    const outposts = [];
    for (let i = LJS.min(1 + (mission/2|0), 4); i--;)
    {
        const w = LJS.randInt(8, 13), h = LJS.randInt(4, 6);
        const x0 = LJS.randInt(25, W-w-4), x1 = x0 + w;
        if (outposts.some(o=> x0 <= o.x1 + 4 && x1 >= o.x0 - 4))
            continue; // keep outposts apart so one never buries another
        let floor = 0;
        for (let x=x0; x<=x1; ++x)
            floor = LJS.max(floor, surface[x]);
        if (floor + h + 3 > H-4)
            continue;

        // level the ground under it and clear the space
        for (let x=x0-1; x<=x1+1; ++x)
        for (let y=1; y<H-1; ++y)
            if (y <= floor)
                fg[x][y] ||= tileGround;
            else if (y <= floor + h + 2)
                fg[x][y] = 0;

        // walls, roof and doors
        const roof = floor + h + 1;
        for (let y=floor+1; y<=roof; ++y)
        {
            fg[x0][y] = fg[x1][y] = y == roof ? tileMetal : tileGround;
            for (let x=x0+1; x<x1; ++x)
                bg[x][y] = tileRock;
        }
        for (let x=x0; x<=x1; ++x)
            fg[x][roof] = x == x0 || x == x1 ? tileMetal : tileGround;
        fg[x0][floor+1] = fg[x0][floor+2] = 0;
        fg[x1][floor+1] = fg[x1][floor+2] = 0;
        ladder(x1-2, floor+1, roof);
        for (let x=x0; x<=x1; ++x)
            surface[x] = roof;
        outposts.push({x0, x1, floor, roof});
    }

    // indestructible bedrock and side walls
    for (let x=0; x<W; ++x)
        fg[x][0] = tileMetal;
    for (let y=0; y<H; ++y)
        fg[0][y] = fg[W-1][y] = tileMetal;

    // find open spots to stand on
    const standable = (x,y)=> inside(x,y) && y < H-2 && !fg[x][y] && !fg[x][y+1] && isSolid(x,y-1);
    const taken = new Set;
    const isFree = (x,y)=>
    {
        for (let dx=-2; dx<=2; ++dx)
            if (taken.has((x+dx)+','+y))
                return false;
        return true;
    };
    const take = (x,y)=> { taken.add(x+','+y); return vec2(x+.5, y+.5); };
    const spots = [];
    for (let x=20; x<W-2; ++x)
    for (let y=1; y<H-2; ++y)
        standable(x,y) && spots.push([x,y]);
    shuffle(spots);
    const pickSpot = (filter=()=>1)=>
    {
        for (const [x,y] of spots)
            if (filter(x,y) && isFree(x,y))
                return take(x,y);
    };

    // hostiles, tougher mix each mission
    const hostiles = [];
    const total = LJS.min(8 + mission*4, 40);
    const turrets = mission > 1 ? LJS.min(1 + (mission >> 1), 6) : 0;
    const soldiers = LJS.round((total - turrets) * LJS.min(.35 + mission*.08, .7));
    for (const o of outposts)
    {
        // two troopers guard every outpost, a turret sits on the roof
        for (let i=2; i--;)
        {
            const x = LJS.randInt(o.x0+1, o.x1-1);
            isFree(x, o.floor+1) && hostiles.push({type:'soldier', pos:take(x, o.floor+1)});
        }
        if (hostiles.filter(h=> h.type=='turret').length < turrets)
        {
            const x = LJS.randInt(o.x0+1, o.x1-3);
            isFree(x, o.roof+1) && hostiles.push({type:'turret', pos:take(x, o.roof+1)});
        }
    }
    const count = (type)=> hostiles.filter(h=> h.type==type).length;
    while (count('turret') < turrets)
    {
        const pos = pickSpot((x,y)=> y > surface[x] - 1);
        if (!pos) break;
        hostiles.push({type:'turret', pos});
    }
    while (count('soldier') < soldiers)
    {
        const pos = pickSpot();
        if (!pos) break;
        hostiles.push({type:'soldier', pos});
    }
    while (hostiles.length < total)
    {
        const pos = pickSpot();
        if (!pos) break;
        hostiles.push({type:'hopper', pos});
    }

    // coins favour the caves, crates sit around the surface
    const coins = [], crates = [];
    for (let i = 12 + mission*2; i--;)
    {
        const pos = pickSpot((x,y)=> y < surface[x] - 1) || pickSpot();
        pos && coins.push(pos);
    }
    for (let i = LJS.randInt(6, 11); i--;)
    {
        const pos = pickSpot();
        pos && crates.push(pos);
    }

    // safety net: drop anything that ended up inside solid ground
    const open = (pos)=> !isSolid(pos.x|0, pos.y|0);
    const spawns =
    {
        hostiles: hostiles.filter(h=> open(h.pos)),
        coins: coins.filter(open),
        crates: crates.filter(open),
    };

    // player starts on the landing zone
    const startX = 4;
    spawns.start = vec2(startX+.5, surface[startX]+1.5);

    // convert grids to Tiled style data, row 0 at the top and tile index + 1
    const toData = (grid)=>
    {
        const data = new Array(W*H).fill(0);
        for (let x=0; x<W; ++x)
        for (let y=0; y<H; ++y)
            if (grid[x][y])
                data[x + (H-1-y)*W] = grid[x][y] + 1;
        return data;
    };
    const map = {width:W, height:H, layers:[{data:toData(bg)}, {data:toData(fg)}]};
    return {map, spawns};
}

function shuffle(array)
{
    for (let i=array.length; i-- > 1;)
    {
        const j = LJS.randInt(i+1);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

///////////////////////////////////////////////////////////////////////////////

function loadLevelData(map)
{
    tileLayers = LJS.tileLayersLoad(map, tile(0,16,1), 0, 1);
    levelSize = tileLayers[0].size;
    foregroundTileLayer = tileLayers[tileLayers.length-1];

    for (let i=tileLayers.length; i--;)
    {
        const tileLayer = tileLayers[i];
        const isForeground = i == tileLayers.length - 1;
        if (!isForeground)
            tileLayer.isSolid = false;

        for (let x=levelSize.x; x--;)
        for (let y=levelSize.y; y--;)
        {
            const pos = vec2(x,y);
            const tileData = tileLayer.getData(pos).tile;

            // get tile type
            let tileType = tileData? tileType_breakable : tileType_empty;
            if (tileData == tileLadder)
                tileType = tileType_ladder;
            if (tileData == tileMetal)
                tileType = tileType_solid;
            if (tileType)
            {
                // set collision for solid tiles
                if (tileLayer.isSolid)
                    tileLayer.setCollisionData(pos, tileType);
                if (tileType == tileType_breakable)
                {
                    // randomize tile appearance
                    let direction = LJS.randInt(4);
                    let mirror = LJS.randInt(2);
                    let color = i ? levelColor : levelBackgroundColor;
                    color = color.mutate(.03);

                    // set tile layer data
                    const data = new LJS.TileLayerData(tileData, direction, mirror, color);
                    tileLayer.setData(pos, data);
                }
            }
        }

        tileLayer.onRedraw = ()=>
        {
            // apply decoration to level tiles
            for (let x=levelSize.x; x--;)
            for (let y=levelSize.y; y--;)
                decorateTile(vec2(x,y), tileLayer);
        }
        tileLayer.redraw();
    }
}

// find a clear place to put the player, near pos if possible
export function findSafeSpawn(pos)
{
    const clear = (x,y)=> LJS.tileCollisionGetData(vec2(x+.5,y+.5)) <= 0;
    const x = LJS.clamp(pos.x|0, 1, levelSize.x-2), y0 = pos.y|0;
    if (clear(x,y0) && clear(x,y0+1))
        return vec2(x+.5, y0+.6);

    // otherwise stand on the highest ground in this column
    for (let y=levelSize.y-3; y>0; --y)
        if (clear(x,y) && clear(x,y+1) && !clear(x,y-1))
            return vec2(x+.5, y+.6);
    return playerStartPos;
}

export function decorateTile(pos, tileLayer)
{
    LJS.ASSERT((pos.x|0) == pos.x && (pos.y|0)== pos.y);
    if (!tileLayer)
        return;

    const w = tileLayer.tileInfo.size.x;
    if (tileLayer == foregroundTileLayer)
    {
        const tileType = tileLayer.getCollisionData(pos);
        if (tileType <= 0)
        {
            // force it to clear if it is empty
            tileType || tileLayer.clearData(pos, true);
            return;
        }
        if (tileType == tileType_breakable)
        for (let i=4;i--;)
        {
            // outline towards neighbors of differing type
            const neighborTileType = tileLayer.getCollisionData(pos.add(vec2().setDirection(i)));
            if (neighborTileType == tileType)
                continue;

            // make pixel perfect outlines
            const size = i&1 ? vec2(2, 16) : vec2(16, 2);
            const drawPos = pos.scale(16)
                .add(vec2(i==1?14:0,(i==0?14:0)))
                .subtract((i&1? vec2(0,8-size.y/2) : vec2(8-size.x/2,0)));
            const color = levelOutlineColor.mutate(.1);
            tileLayer.drawLayerRect(drawPos, size, color);
        }
    }
    else
    {
        // make round corners
        for (let i=4; i--;)
        {
            // check corner neighbors (getData returns undefined for out-of-bounds)
            const neighborTileDataA = tileLayer.getData(pos.add(vec2().setDirection(i)))?.tile;
            const neighborTileDataB = tileLayer.getData(pos.add(vec2().setDirection((i+1)%4)))?.tile;
            if (neighborTileDataA > 0 || neighborTileDataB > 0)
                continue;

            // get direction of corner
            const directionVector = vec2();
            if (i==0) directionVector.set(w-1,w-1);
            if (i==1) directionVector.set(w-1,1);
            if (i==2) directionVector.set(1,1);
            if (i==3) directionVector.set(1,w-1);

            // clear rect from corner
            const s = vec2(2);
            const drawPos = pos.scale(w).add(directionVector).subtract(s.scale(.5));
            tileLayer.clearLayerRect(drawPos, s);
        }
    }
}

export function getCameraTarget()
{
    // camera is above player
    const offset = 100/LJS.cameraScale*LJS.percent(LJS.mainCanvasSize.y, 300, 600);
    return Game.player.pos.add(vec2(0, offset));
}
