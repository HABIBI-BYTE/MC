function randomMs(minMs, maxMs) {
    return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function setupLeaveRejoin(bot) { // Rimosso createBot dai parametri
    let leaveTimer = null;
    let jumpTimer = null;
    let jumpOffTimer = null;
    let stopped = false;

    function cleanup() {
        stopped = true;
        if (leaveTimer) clearTimeout(leaveTimer);
        if (jumpTimer) clearTimeout(jumpTimer);
        if (jumpOffTimer) clearTimeout(jumpOffTimer);
        leaveTimer = jumpTimer = jumpOffTimer = null;
    }

    function scheduleNextJump() {
        if (stopped || !bot.entity) return;

        bot.setControlState('jump', true);
        jumpOffTimer = setTimeout(() => {
            if (bot.setControlState) bot.setControlState('jump', false);
        }, 300);

        const nextJump = randomMs(20000, 5 * 60 * 1000);
        jumpTimer = setTimeout(scheduleNextJump, nextJump);
    }

    bot.once('spawn', () => {
        cleanup();
        stopped = false;

        // Resta connesso tra 1 e 5 minuti
        const stayTime = randomMs(60000, 300000);
        console.log(`[AFK] Schedulata disconnessione ciclica tra ${Math.round(stayTime / 1000)} secondi`);

        scheduleNextJump();

        leaveTimer = setTimeout(() => {
            if (stopped) return;
            console.log('[AFK] Disconnessione programmata per ciclo Rejoin...');
            cleanup();
            try {
                bot.quit('Periodic Rejoin'); // Passiamo il motivo preciso
            } catch (e) {}
        }, stayTime);
    });

    bot.on('end', () => cleanup());
    bot.on('kicked', () => cleanup());
    bot.on('error', () => cleanup());
}

module.exports = setupLeaveRejoin;
