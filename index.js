const fetch = require('node-fetch');
const WebSocket = require('ws');
const https = require('https');
const path = require('path');
const fs = require('fs');

const matchCorePrefix = '/riot-messaging-service/v1/message/ares-core-game/core-game/v1/matches/';

const localAgent = new https.Agent({
    rejectUnauthorized: false
});

async function asyncTimeout(delay) {
    return new Promise(resolve => {
        setTimeout(resolve, delay);
    });
}

async function getLockfileData() {
    const lockfilePath = path.join(process.env['LOCALAPPDATA'], 'Riot Games\\Riot Client\\Config\\lockfile');
    const contents = await fs.promises.readFile(lockfilePath, 'utf8');
    let d = {};
    [d.name, d.pid, d.port, d.password, d.protocol] = contents.split(':');
    return d;
}

async function getSession(port, password) {
    return (await fetch(`https://127.0.0.1:${port}/chat/v1/session`, {
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`riot:${password}`).toString('base64')
        },
        agent: localAgent
    })).json();
}

async function getToken(port, password) {
    return (await fetch(`https://127.0.0.1:${port}/entitlements/v1/token`, {
        headers: {
            'Authorization': 'Basic ' + Buffer.from(`riot:${password}`).toString('base64')
        },
        agent: localAgent
    })).json();
}

async function waitForLockfile() {
    return new Promise(async (resolve, reject) => {
        const watcher = fs.watch(path.join(process.env['LOCALAPPDATA'], 'Riot Games\\Riot Client\\Config\\'), (eventType, fileName) => {
            if(eventType === 'rename' && fileName === 'lockfile') {
                watcher.close();
                resolve();
            }
        });
    });
}

const region = 'na';
const clientPlatform = 'ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9';
const clientVersion = 'release-03.08-7-622822';

async function writeError(body) {
    const errorDir = path.join(__dirname, 'errors');
    try {
        await fs.promises.mkdir(errorDir);
    } catch(ignored) {}
    await fs.promises.writeFile(path.join(errorDir, ((new Date()).getTime()) + '.html'), body, 'utf-8');
}

async function getMatchDetails(id, token, entitlement) {
    const url = `https://pd.${region}.a.pvp.net/match-details/v1/matches/${id}`;
    const headers = {
        'X-Riot-Entitlements-JWT': entitlement,
        'X-Riot-ClientPlatform': clientPlatform,
        'X-Riot-ClientVersion': clientVersion,
        Authorization: 'Bearer ' + token,
        'User-Agent': ''
    };
    const options = {
        method: 'GET',
        headers
    };
    const body = await (await fetch(url, options)).text();
    try {
        return JSON.parse(body);
    } catch(e) {
        await writeError(body);
        throw e;
    }
}

async function getMatchHistory(puuid, queueID, token, entitlement) {
    let url = `https://pd.${region}.a.pvp.net/match-history/v1/history/${puuid}?endIndex=6`;
    const headers = {
        'X-Riot-Entitlements-JWT': entitlement,
        'X-Riot-ClientPlatform': clientPlatform,
        'X-Riot-ClientVersion': clientVersion,
        Authorization: 'Bearer ' + token,
        'User-Agent': ''
    };
    const options = {
        method: 'GET',
        qs: {endIndex: '20'},
        headers
    };
    if(queueID) {
        url += '&queue=' + queueID;
    }
    const body = await (await fetch(url, options)).text();
    try {
        return JSON.parse(body);
    } catch(e) {
        await writeError(body);
        throw e;
    }
}

async function getPlayerMMR(puuid, token, entitlement) {
    const url = `https://pd.${region}.a.pvp.net/mmr/v1/players/${puuid}`;
    const headers = {
        'X-Riot-Entitlements-JWT': entitlement,
        'X-Riot-ClientPlatform': clientPlatform,
        'X-Riot-ClientVersion': clientVersion,
        Authorization: 'Bearer ' + token,
        'User-Agent': ''
    };
    const options = {
        method: 'GET',
        headers
    };
    const body = await (await fetch(url, options)).text();
    try {
        return JSON.parse(body);
    } catch(e) {
        await writeError(body);
        throw e;
    }
}

async function dumpPlayer(puuid, token, entitlement, ignoreGameIDs, delay) {
    // Grab player mmr
    const mmr = await getPlayerMMR(puuid, token, entitlement);
    await asyncTimeout(delay);

    // Grab recent games
    const recentGames = await getMatchHistory(puuid, null, token, entitlement);
    await asyncTimeout(delay);

    // Grab recent deathmatch games
    const deathmatchGames = await getMatchHistory(puuid, 'deathmatch', token, entitlement);
    await asyncTimeout(delay);

    // Grab match details for deathmatch games
    const deathmatchDetails = [];
    for(const dmGame of deathmatchGames['History']) {
        if(ignoreGameIDs.includes(dmGame['MatchID'])) continue;
        deathmatchDetails.push(await getMatchDetails(dmGame['MatchID'], token, entitlement));
        await asyncTimeout(delay);
    }

    // Grab match details for other games
    const otherDetails = [];
    for(const otherGame of recentGames['History']) {
        if(ignoreGameIDs.includes(otherGame['MatchID'])) continue;
        if(deathmatchGames['History'].some(dmGame => dmGame['MatchID'] === otherGame['MatchID'])) continue;

        otherDetails.push(await getMatchDetails(otherGame['MatchID'], token, entitlement));
        await asyncTimeout(delay);
    }

    return {
        mmr,
        recentGames,
        deathmatchGames,
        deathmatchDetails,
        otherDetails
    };
}

function formatMatchName(matchDetails) {
    // From https://stackoverflow.com/a/13219636
    const gameDateStr = new Date(matchDetails['matchInfo']['gameStartMillis']).toISOString()
        .replace(/T/, '_')
        .replaceAll(':', '-')
        .replace(/\..+/, '');
    return `${gameDateStr}_${matchDetails['matchInfo']['queueID']}`;
}

async function dumpGame(gameID, presences, outDir, token, entitlement, delay) {
    console.group(`Loading match id ${gameID}...`);

    const matchDetails = await getMatchDetails(gameID, token, entitlement)
    await asyncTimeout(delay);

    const gameDirName = formatMatchName(matchDetails);
    console.log(gameDirName);

    const gamePath = path.join(outDir, gameDirName);
    await fs.promises.mkdir(gamePath);
    await fs.promises.writeFile(path.join(gamePath, 'match.json'), JSON.stringify(matchDetails, null, 4), 'utf-8');

    let i = 0;
    for(const player of matchDetails['players']) {
        console.log(`Loading player ${i+1} of ${matchDetails['players'].length}...`);

        const playerDir = path.join(gamePath, player['subject']);
        const deathmatchesDir = path.join(playerDir, 'deathmatches');
        const otherDir = path.join(playerDir, 'other');
        await fs.promises.mkdir(playerDir);
        await fs.promises.mkdir(deathmatchesDir);
        await fs.promises.mkdir(otherDir);

        const playerData = await dumpPlayer(player['subject'], token, entitlement, [gameID], delay);
        await fs.promises.writeFile(path.join(playerDir, 'mmr.json'), JSON.stringify(playerData.mmr, null, 4), 'utf-8');
        await fs.promises.writeFile(path.join(playerDir, 'recentGames.json'), JSON.stringify(playerData.recentGames, null, 4), 'utf-8');
        await fs.promises.writeFile(path.join(playerDir, 'deathmatchGames.json'), JSON.stringify(playerData.deathmatchGames, null, 4), 'utf-8');

        if(presences.has(player['subject'])) {
            await fs.promises.writeFile(path.join(playerDir, 'presence.json'), JSON.stringify(presences.get(player['subject']), null, 4), 'utf-8');
        }

        for(const deathmatchGame of playerData.deathmatchDetails) {
            await fs.promises.writeFile(path.join(deathmatchesDir, formatMatchName(deathmatchGame) + '.json'), JSON.stringify(deathmatchGame, null, 4), 'utf-8');
        }

        for(const otherGame of playerData.otherDetails) {
            await fs.promises.writeFile(path.join(otherDir, formatMatchName(otherGame) + '.json'), JSON.stringify(otherGame, null, 4), 'utf-8');
        }

        i++;
    }
    console.log('Done!');
    console.groupEnd();
}

(async () => {

    const outDir = path.join(__dirname, 'out');
    try {
        await fs.promises.mkdir(outDir);
    } catch(ignored) {}

    let lockData = null;
    do {
        try {
            lockData = await getLockfileData();
        } catch(e) {
            console.log('Waiting for lockfile...');
            await waitForLockfile();
            await asyncTimeout(1500);
        }
    } while(lockData === null);

    console.log('Got lock data');

    let sessionData = null;
    do {
        try {
            sessionData = await getSession(lockData.port, lockData.password);
            if(sessionData.loaded === false) {
                await asyncTimeout(1500);
                sessionData = null;
            }
        } catch(e) {
            console.log('Unable to get session data, retrying...');
            await asyncTimeout(1500);
        }
    } while(sessionData === null);

    console.log('Got session data');

    const tokenData = await getToken(lockData.port, lockData.password);

    const ws = new WebSocket(`wss://riot:${lockData.password}@localhost:${lockData.port}`, {
        rejectUnauthorized: false
    });

    ws.on('open', () => {
        console.log('Connected to websocket!');
        ws.send(JSON.stringify([5, 'OnJsonApiEvent_chat_v4_presences']));
        ws.send(JSON.stringify([5, 'OnJsonApiEvent_riot-messaging-service_v1_message']));
    });

    let wasInGame = false;
    let gameID = '';
    let presences = new Map();

    ws.on('message', dataStr => {
        let event, data;
        try {
            [, event, data] = JSON.parse(dataStr);
        } catch(e) {
            return;
        }
        if(event === 'OnJsonApiEvent_chat_v4_presences') {
            for(const presence of data.data.presences) {
                try {
                    const decoded = presence;
                    decoded.private = JSON.parse(Buffer.from(decoded.private, 'base64').toString('utf-8'));

                    const nowInGame = (decoded.private.sessionLoopState === 'INGAME');

                    // Check if the player recently entered or left a game
                    if(decoded.puuid === sessionData.puuid) {
                        if(wasInGame && !nowInGame) {
                            // No longer in a game
                            wasInGame = false;

                            const presenceDupe = new Map(presences);
                            presences.clear();
                            dumpGame(gameID, presenceDupe, outDir, tokenData['accessToken'], tokenData['token'], 1200);
                        } else if(!wasInGame && nowInGame) {
                            // Now in a game
                            wasInGame = true;
                        }
                    }

                    // Add to presences map if actively in a game
                    if(nowInGame && !presences.has(decoded.puuid) && decoded.private.queueId.length > 0) {
                        presences.set(decoded.puuid, decoded);
                    }
                } catch(ignored) {}
            }
        } else if(event === 'OnJsonApiEvent_riot-messaging-service_v1_message') {
            // Populate game ID
            if(data.uri.startsWith(matchCorePrefix)) {
                gameID = data.uri.substring(matchCorePrefix.length);
            }
        }
    });

    ws.on('close', () => {
        console.log('Websocket closed!');
    });
})();
