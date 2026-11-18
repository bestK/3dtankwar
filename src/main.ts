import './styles/main.css';
import { GameApp, GameUiBridge, HudSnapshot } from './GameApp';
import { PeerPresence, PublicRoomBeacon, TileType } from './types';

function $(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

function $all(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll(selector));
}

window.addEventListener('DOMContentLoaded', () => {
  const canvasRoot = $('#canvas-root')!;

  // Top Tactical Bar
  const hudTop = $('#hud-top')!;
  const btnHome = $('#btn-home')!;
  const hudStagePill = $('#hud-stage-pill')!;
  const hudEnemyStrip = $('#hud-enemy-strip')!;
  const hudRoomChip = $('#hud-room-chip')!;
  const hudRoomCode = $('#hud-room-code')!;
  const hudNetDot = $('#hud-net-dot')!;
  const hudNetPing = $('#hud-net-ping')!;
  const btnCopyRoom = $('#btn-copy-room')!;
  const hudScoreboard = $('#hud-scoreboard')!;

  const hudHpFill = $('#hud-hp-fill')!;
  const hudLives = $('#hud-lives')!;
  const hudStars = $('#hud-stars')!;
  const hudScore = $('#hud-score')!;

  const btnCamera = $('#btn-camera')!;
  const btnSlowmo = $('#btn-slowmo')!;
  const btnAudio = $('#btn-audio')!;

  // Charge Bar & Toasts
  const chargeWrap = $('#charge-bar-wrap')!;
  const chargeFill = $('#charge-bar-fill')!;
  const eventFeed = $('#event-feed')!;

  // Workshop Sculpting Palette
  const workshopBar = $('#workshop-bar')!;
  const brushButtons = $all('.brush-chip');
  const btnWsTemplate = $('#btn-ws-template')!;
  const btnWsClear = $('#btn-ws-clear')!;
  const btnWsPlay = $('#btn-ws-play')!;

  // Hero & Online Lobby
  const heroOverlay = $('#hero-overlay')!;
  const btnBrokerToggle = $('#btn-broker-toggle')!;
  const brokerPopover = $('#broker-popover')!;
  const selectBrokerUrl = $('#select-broker-url') as HTMLSelectElement;
  const btnBrokerReconnect = $('#btn-broker-reconnect')!;
  const netLed = $('#net-led')!;
  const netLabel = $('#net-label')!;
  const netPing = $('#net-ping')!;

  const modeTabs = $all('.mode-tab');
  const panelCampaign = $('#panel-campaign')!;
  const panelOnline = $('#panel-online')!;
  const panelWorkshop = $('#panel-workshop')!;

  const campaignStageButtons = $all('.stage-pill');
  const btnStartCampaign = $('#btn-start-campaign')!;

  const inputCallsign = $('#input-callsign') as HTMLInputElement;
  const inputRoom = $('#input-room') as HTMLInputElement;
  const btnJoinRoom = $('#btn-join-room')!;
  const btnQuickMatch = $('#btn-quick-match')!;
  const btnShareLink = $('#btn-share-link')!;
  const pvpMapButtons = $all('.pvp-map-pill');
  const activeRoomsStrip = $('#active-rooms-strip')!;
  const lobbyRoster = $('#lobby-roster')!;
  const btnStartOnline = $('#btn-start-online')!;

  const btnEnterWorkshop = $('#btn-enter-workshop')!;

  // Result Modal
  const resultModal = $('#result-modal')!;
  const resultTitle = $('#result-title')!;
  const resultStats = $('#result-stats')!;
  const btnResultNext = $('#btn-result-next')!;
  const btnResultMenu = $('#btn-result-menu')!;

  let currentSelectedMode: 'campaign' | 'pvp' | 'coop' | 'workshop' = 'campaign';
  let selectedCampaignStage = 0;
  let selectedPvpMap = 0;
  let canNextStageAction = false;

  const showToast = (msg: string) => {
    const toast = document.createElement('div');
    toast.className = 'feed-toast';
    toast.textContent = msg;
    eventFeed.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2900);
  };

  const copyRoomLink = (roomId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('room', roomId);
    url.searchParams.set('mode', currentSelectedMode === 'coop' ? 'coop' : 'pvp');
    navigator.clipboard
      ?.writeText(url.toString())
      .then(() => showToast(`邀请链接已复制: #${roomId}`))
      .catch(() => {
        prompt('请复制邀请链接：', url.toString());
      });
  };

  const uiBridge: GameUiBridge = {
    onHudUpdate: (hud: HudSnapshot) => {
      if (hud.mode === 'demo') {
        hudTop.classList.add('hidden');
        chargeWrap.classList.add('hidden');
        return;
      }
      hudTop.classList.remove('hidden');

      // Stage & wave
      if (hud.mode === 'campaign' || hud.mode === 'coop') {
        hudStagePill.textContent = `第 0${hud.stageIndex + 1} 关`;
        hudStagePill.classList.remove('hidden');
        hudEnemyStrip.classList.remove('hidden');

        // Draw remaining enemy pips
        hudEnemyStrip.innerHTML = '';
        for (let i = 0; i < Math.min(20, hud.enemyWaveLeft); i++) {
          const pip = document.createElement('span');
          pip.className = 'enemy-pip' + (i % 4 === 1 ? ' heavy' : '');
          hudEnemyStrip.appendChild(pip);
        }
      } else {
        hudStagePill.classList.add('hidden');
        hudEnemyStrip.classList.add('hidden');
      }

      // Online Room Badge
      if (hud.mode === 'pvp' || hud.mode === 'coop') {
        hudRoomChip.classList.remove('hidden');
        hudRoomCode.textContent = `#${app.net.roomId}`;
      } else {
        hudRoomChip.classList.add('hidden');
      }

      // Player stats
      const hpPct = Math.max(0, Math.min(100, (hud.hp / Math.max(1, hud.maxHp)) * 100));
      hudHpFill.style.width = `${hpPct}%`;
      hudHpFill.classList.toggle('low', hpPct <= 34);

      hudLives.innerHTML =
        hud.mode === 'pvp'
          ? `PVP`
          : `<span>♥</span>×${Math.max(0, hud.lives)}`;

      hudStars.textContent = '★'.repeat(Math.max(1, Math.min(3, hud.stars)));
      hudScore.textContent = hud.score.toString().padStart(6, '0');

      // Charge bar
      if (hud.chargeRatio > 0.05) {
        chargeWrap.classList.remove('hidden');
        chargeFill.style.width = `${Math.min(100, Math.round(hud.chargeRatio * 100))}%`;
      } else {
        chargeWrap.classList.add('hidden');
      }

      // Tool buttons
      btnCamera.textContent =
        hud.cameraPreset === 'diorama'
          ? '沙盘视角'
          : hud.cameraPreset === 'chase'
            ? '追尾视角'
            : '自由环视';
      btnSlowmo.classList.toggle('active', hud.slowMo);
    },

    onNetStatus: (st, url, ping) => {
      netLed.className = `net-dot ${st}`;
      hudNetDot.className = `net-dot ${st}`;

      try {
        const u = new URL(url);
        netLabel.textContent = u.hostname || 'broker.emqx.io';
      } catch {
        netLabel.textContent = 'broker.emqx.io';
      }

      const pingStr = ping !== null ? `${ping}ms` : '--';
      netPing.textContent = pingStr;
      hudNetPing.textContent = pingStr;
    },

    onRosterUpdate: (peers: PeerPresence[], hostId: string | null) => {
      // Lobby roster
      lobbyRoster.innerHTML = '';
      peers.forEach((p) => {
        const item = document.createElement('div');
        item.className = 'lobby-player' + (p.peerId === hostId ? ' host' : '');
        const colHex = '#' + p.color.toString(16).padStart(6, '0');
        item.innerHTML = `<span class="swatch" style="background:${colHex}"></span><span>${p.name}${p.peerId === app.net.peerId ? ' (你)' : ''}</span>${p.peerId === hostId ? ' 👑' : ''}`;
        lobbyRoster.appendChild(item);
      });

      // Combat HUD scoreboard (for PvP)
      if (app.mode === 'pvp') {
        hudScoreboard.classList.remove('hidden');
        hudScoreboard.innerHTML = '';
        peers.forEach((p) => {
          const pill = document.createElement('div');
          pill.className = 'roster-pill';
          const colHex = '#' + p.color.toString(16).padStart(6, '0');
          pill.innerHTML = `<span class="roster-swatch" style="background:${colHex}"></span><span>${p.name}</span><span class="roster-kills">${p.kills} 击毁</span>`;
          hudScoreboard.appendChild(pill);
        });
      } else {
        hudScoreboard.classList.add('hidden');
      }
    },

    onPublicRooms: (rooms: PublicRoomBeacon[]) => {
      activeRoomsStrip.innerHTML = '';
      rooms.forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'room-beacon';
        btn.innerHTML = `<span>#${r.roomId}</span><span>[${r.mode === 'pvp' ? '死斗' : '守卫'}]</span><span>${r.count}人</span>`;
        btn.onclick = () => {
          inputRoom.value = r.roomId;
          setModeTab(r.mode);
          app.net.joinRoom(r.roomId, r.mode);
          showToast(`已切换至公开房间 #${r.roomId}`);
        };
        activeRoomsStrip.appendChild(btn);
      });
    },

    onToast: (msg: string) => {
      showToast(msg);
    },

    onMatchEnd: (victory: boolean, title: string, statsText: string, canNext: boolean) => {
      resultTitle.textContent = title;
      resultTitle.style.color = victory ? 'var(--brass-bright)' : 'var(--crimson-alert)';
      resultStats.textContent = statsText;
      canNextStageAction = canNext;
      btnResultNext.textContent = canNext ? '下一战区' : '重新出击';
      resultModal.classList.remove('hidden');
    },

    onOnlineMatchStarted: (_mode: 'pvp' | 'coop') => {
      heroOverlay.classList.add('hidden');
      workshopBar.classList.add('hidden');
      resultModal.classList.add('hidden');
    },
  };

  const app = new GameApp(canvasRoot, uiBridge);

  // Set callsign field
  inputCallsign.value = app.net.callsign;
  inputCallsign.addEventListener('change', () => {
    app.net.setCallsign(inputCallsign.value);
  });

  // URL query params auto-join
  const urlParams = new URLSearchParams(window.location.search);
  const qRoom = urlParams.get('room');
  const qMode = urlParams.get('mode');
  if (qRoom) inputRoom.value = qRoom.slice(0, 8);
  if (qMode === 'pvp' || qMode === 'coop') {
    currentSelectedMode = qMode;
  }

  // Broker toggle & reconnect
  btnBrokerToggle.onclick = () => {
    brokerPopover.classList.toggle('hidden');
  };
  btnBrokerReconnect.onclick = () => {
    const url = selectBrokerUrl.value;
    app.net.connect(url);
    brokerPopover.classList.add('hidden');
    showToast(`正在重连 Broker: ${url}`);
  };

  // Mode Tabs Switching
  const setModeTab = (mode: 'campaign' | 'pvp' | 'coop' | 'workshop') => {
    currentSelectedMode = mode;
    modeTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-mode') === mode);
    });

    panelCampaign.classList.toggle('hidden', mode !== 'campaign');
    panelOnline.classList.toggle('hidden', mode !== 'pvp' && mode !== 'coop');
    panelWorkshop.classList.toggle('hidden', mode !== 'workshop');

    const pvpMapStrip = $('#pvp-map-strip');
    if (pvpMapStrip) {
      pvpMapStrip.classList.toggle('hidden', mode !== 'pvp');
    }

    if (mode === 'pvp' || mode === 'coop') {
      app.net.joinRoom(inputRoom.value || '1985', mode);
    }
  };

  modeTabs.forEach((tab) => {
    tab.onclick = () => {
      const mode = tab.getAttribute('data-mode') as 'campaign' | 'pvp' | 'coop' | 'workshop';
      setModeTab(mode);
    };
  });
  setModeTab(currentSelectedMode);

  // Campaign Stage Pills
  campaignStageButtons.forEach((pill) => {
    pill.onclick = () => {
      campaignStageButtons.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedCampaignStage = parseInt(pill.getAttribute('data-stage') || '0', 10);
    };
  });

  btnStartCampaign.onclick = () => {
    heroOverlay.classList.add('hidden');
    workshopBar.classList.add('hidden');
    resultModal.classList.add('hidden');
    app.startCampaign(selectedCampaignStage);
  };

  // PvP Map Selection
  pvpMapButtons.forEach((pill) => {
    pill.onclick = () => {
      pvpMapButtons.forEach((p) => p.classList.remove('active'));
      pill.classList.add('active');
      selectedPvpMap = parseInt(pill.getAttribute('data-pvpmap') || '0', 10);
    };
  });

  // Online Room Controls
  btnJoinRoom.onclick = () => {
    const raw = inputRoom.value.trim() || '1985';
    app.net.joinRoom(raw, currentSelectedMode === 'coop' ? 'coop' : 'pvp');
    showToast(`已进入房间 #${app.net.roomId}`);
  };

  btnQuickMatch.onclick = () => {
    const publicList = app.net.getPublicRooms();
    if (publicList.length > 0) {
      const target = publicList[0];
      inputRoom.value = target.roomId;
      setModeTab(target.mode);
      app.net.joinRoom(target.roomId, target.mode);
      showToast(`已匹配至活跃房间 #${target.roomId}`);
    } else {
      const randRoom = Math.floor(1000 + Math.random() * 8999).toString();
      inputRoom.value = randRoom;
      app.net.joinRoom(randRoom, currentSelectedMode === 'coop' ? 'coop' : 'pvp');
      showToast(`已创建公开战区 #${randRoom}`);
    }
  };

  btnShareLink.onclick = () => copyRoomLink(app.net.roomId);
  btnCopyRoom.onclick = () => copyRoomLink(app.net.roomId);

  btnStartOnline.onclick = () => {
    const isPvp = currentSelectedMode === 'pvp';
    app.hostStartOnlineMatch(isPvp ? 'pvp' : 'coop', isPvp ? selectedPvpMap : selectedCampaignStage);
  };

  // Workshop Entry & Controls
  btnEnterWorkshop.onclick = () => {
    heroOverlay.classList.add('hidden');
    workshopBar.classList.remove('hidden');
    hudTop.classList.add('hidden');
    resultModal.classList.add('hidden');
    app.enterWorkshop();
    showToast('沙盘工坊已就绪：左键绘制，右键360°旋转，Shift精细点选');
  };

  brushButtons.forEach((btn) => {
    btn.onclick = () => {
      brushButtons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const brushVal = parseInt(btn.getAttribute('data-brush') || '1', 10);
      app.workshopBrush = brushVal as TileType;
    };
  });

  btnWsTemplate.onclick = () => {
    app.resetWorkshopGrid(false);
    showToast('已载入经典防线模板');
  };

  btnWsClear.onclick = () => {
    app.resetWorkshopGrid(true);
    showToast('战场已清空');
  };

  btnWsPlay.onclick = () => {
    workshopBar.classList.add('hidden');
    app.launchWorkshopTest();
  };

  // Tactical Controls (Home / Camera / Slowmo / Audio)
  btnHome.onclick = () => {
    heroOverlay.classList.remove('hidden');
    workshopBar.classList.add('hidden');
    resultModal.classList.add('hidden');
    app.startHeroDemo();
  };

  btnCamera.onclick = () => {
    const nextPreset = app.cycleCameraPreset();
    btnCamera.textContent =
      nextPreset === 'diorama' ? '沙盘视角' : nextPreset === 'chase' ? '追尾视角' : '自由环视';
    showToast(`视角切换: ${btnCamera.textContent}`);
  };

  btnSlowmo.onclick = () => {
    const on = app.toggleSlowMo();
    btnSlowmo.classList.toggle('active', on);
    showToast(on ? '子弹时间已开启' : '子弹时间已关闭');
  };

  btnAudio.onclick = () => {
    app.audio.unlock();
    const next = !app.audio.enabled;
    app.audio.setEnabled(next);
    btnAudio.classList.toggle('active', next);
    btnAudio.textContent = next ? '音效' : '静音';
    showToast(next ? '音效系统已开启' : '音效已静音');
  };

  // Result Modal Actions
  btnResultNext.onclick = () => {
    resultModal.classList.add('hidden');
    if (canNextStageAction) {
      selectedCampaignStage = Math.min(4, selectedCampaignStage + 1);
      campaignStageButtons.forEach((p, idx) => {
        p.classList.toggle('active', idx === selectedCampaignStage);
      });
      app.startCampaign(selectedCampaignStage);
    } else {
      if (app.mode === 'campaign') {
        app.startCampaign(selectedCampaignStage);
      } else if (app.mode === 'pvp' || app.mode === 'coop') {
        app.hostStartOnlineMatch(app.mode, app.mode === 'pvp' ? selectedPvpMap : selectedCampaignStage);
      }
    }
  };

  btnResultMenu.onclick = () => {
    resultModal.classList.add('hidden');
    heroOverlay.classList.remove('hidden');
    workshopBar.classList.add('hidden');
    app.startHeroDemo();
  };
});
