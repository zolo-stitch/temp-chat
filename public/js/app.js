import { nanoid } from './nanoid/nanoid.js';

    class ChatApp {
      constructor() {
        this.currentUser = `user_${nanoid(5)}`;
        this.chatId = window.location.pathname.match(/\/chat\/(.+)/)?.[1] || null;
        this.ws = null;
        this.localStream = null;
        this.peerConnections = new Map();
        this.elements = this.getElements();
        this.setupListeners();
        if (this.chatId) this.joinChat();
      }

      getElements = () => ({
        localVideo: document.getElementById('localVideo'),
        videoContainer: document.querySelector('.video-container'),
        messages: document.getElementById('messages'),
        messageInput: document.getElementById('messageInput'),
        sendMessage: document.getElementById('sendMessage'),
        createChat: document.getElementById('createChat'),
        toggleVideoCall: document.getElementById('toggleVideoCall'),
        chatLink: document.getElementById('chatLink'),
        statusMessage: document.getElementById('statusMessage'),
        dashboard: document.getElementById('dashboard'),
      });

      setupListeners = () => {
        this.elements.sendMessage.addEventListener('click', () => this.sendMessage());
        this.elements.createChat.addEventListener('click', () => this.createChat());
        this.elements.toggleVideoCall.addEventListener('click', () => this.toggleVideo());
        this.elements.messageInput.addEventListener('keypress', (e) => e.key === 'Enter' && this.sendMessage());
        window.addEventListener('beforeunload', () => this.cleanup());
      };

      createChat = () => {
        this.chatId = nanoid(12);
        const link = `${window.location.origin}/chat/${this.chatId}`;
        this.updateChatUI(link);
        this.joinChat();
      };

      joinChat = () => {
        const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const wsUrl = `${wsProtocol}://${location.hostname}${location.port ? ':' + location.port : ''}/chat/${this.chatId}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          this.ws.send(JSON.stringify({ type: 'join', user: this.currentUser }));
          this.showStatus('Connected to chat!');
          this.elements.dashboard.classList.remove('hidden');
          this.elements.createChat.classList.add('hidden');
          const link = `${window.location.origin}/chat/${this.chatId}`;
          this.elements.chatLink.innerHTML = `Chat Link: <a href="${link}" target="_blank">${link}</a>`;
        };
        this.ws.onmessage = (e) => {
          try {
            this.handleMessage(JSON.parse(e.data));
          } catch (err) {
            this.showStatus('Failed to parse message');
          }
        };
        this.ws.onerror = () => this.showStatus('WebSocket error occurred.');
        this.ws.onclose = () => {
          this.showStatus('Disconnected from chat.');
          this.cleanup();
        };
      };

      updateChatUI = (link) => {
        this.elements.chatLink.innerHTML = `Chat Link: <a href="${link}" target="_blank">${link}</a>`;
        window.history.pushState({}, '', `/chat/${this.chatId}`);
        this.elements.dashboard.classList.remove('hidden');
        this.elements.createChat.classList.add('hidden');
      };

      handleMessage = (data) => {
        const handlers = {
          chatStatus: () => {
            if (data.messages && Array.isArray(data.messages)) {
              this.elements.messages.innerHTML = data.messages.map(this.formatMessage).join('');
              this.scrollMessages();
            }
            if (data.videoUsers && Array.isArray(data.videoUsers) && this.localStream) {
              data.videoUsers.forEach((user) => {
                if (user !== this.currentUser && !this.peerConnections.has(user)) {
                  this.createOffer(user);
                }
              });
            }
          },
          message: () => {
            this.elements.messages.innerHTML += this.formatMessage(data);
            this.scrollMessages();
          },
          userJoined: () => {},
          videoStarted: () => {
            if (data.user !== this.currentUser && this.localStream && !this.peerConnections.has(data.user)) {
              this.createOffer(data.user);
            }
            if (data.videoUsers && Array.isArray(data.videoUsers) && this.localStream) {
              data.videoUsers.forEach((user) => {
                if (user !== this.currentUser && !this.peerConnections.has(user)) {
                  this.createOffer(user);
                }
              });
            }
          },
          videoStopped: () => this.handleUserLeft(data.user),
          offer: () => this.handleOffer(data.from, data.offer),
          answer: () => this.handleAnswer(data.from, data.answer),
          'ice-candidate': () => this.handleIceCandidate(data.from, data.candidate),
          userLeft: () => this.handleUserLeft(data.user),
          error: () => this.showStatus(data.message),
        };
        handlers[data.type]?.();
      };

      formatMessage = (msg) => {
        const isSelf = msg.from === this.currentUser;
        return `<div class="message ${isSelf ? 'message-self' : 'message-other'}">${msg.from}: ${msg.message}</div>`;
      };

      sendMessage = () => {
        const message = this.elements.messageInput.value.trim();
        if (message && this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'message', from: this.currentUser, message }));
          this.elements.messageInput.value = '';
        }
      };

      toggleVideo = async () => {
        if (this.localStream) {
          this.stopVideo();
        } else {
          await this.startVideo();
        }
        this.elements.toggleVideoCall.textContent = this.localStream ? 'Stop Video Call' : 'Start Video Call';
      };

      startVideo = async () => {
        try {
          this.localStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: { echoCancellation: true, noiseSuppression: true }
          });
          
          const localVideoWrapper = this.elements.localVideo.parentElement;
          this.elements.localVideo.srcObject = this.localStream;
          this.elements.localVideo.muted = true;

          if (!localVideoWrapper.querySelector('.video-controls')) {
            const controls = document.createElement('div');
            controls.className = 'video-controls';

            const muteButton = document.createElement('button');
            muteButton.textContent = 'Unmute';
            muteButton.className = 'btn btn-primary';

            const playButton = document.createElement('button');
            playButton.textContent = 'Play';
            playButton.className = 'btn btn-primary';

            controls.append(muteButton, playButton);
            localVideoWrapper.appendChild(controls);

            muteButton.addEventListener('click', () => {
              this.elements.localVideo.muted = !this.elements.localVideo.muted;
              muteButton.textContent = this.elements.localVideo.muted ? 'Unmute' : 'Mute';
            });

            playButton.addEventListener('click', async () => {
              try {
                if (this.elements.localVideo.paused) {
                  await this.elements.localVideo.play();
                  playButton.textContent = 'Stop';
                } else {
                  this.elements.localVideo.pause();
                  playButton.textContent = 'Play';
                }
              } catch (err) {
                this.showStatus('Failed to control local video: ' + err.message);
              }
            });
          }

          const playPromise = this.elements.localVideo.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                localVideoWrapper.querySelector('.video-controls button:nth-child(2)').textContent = 'Stop';
                if (this.ws?.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({ type: 'videoStarted', user: this.currentUser }));
                }
              })
              .catch((err) => {
                this.showStatus('Failed to play local video: ' + err.message);
                this.stopVideo();
              });
          }
        } catch (err) {
          this.showStatus('Failed to access media devices: ' + err.message);
          this.localStream = null;
        }
      };

      stopVideo = () => {
        if (this.localStream) {
          this.localStream.getTracks().forEach((track) => track.stop());
          this.localStream = null;
        }
        this.peerConnections.forEach((pc) => pc.close());
        this.peerConnections.clear();
        
        const localVideoWrapper = this.elements.localVideo.parentElement;
        this.elements.localVideo.srcObject = null;
        
        const controls = localVideoWrapper.querySelector('.video-controls');
        if (controls) controls.remove();
        
        this.elements.videoContainer.innerHTML = '<div class="video-wrapper"><video id="localVideo" autoplay muted playsinline></video><span class="video-label">You</span></div>';
        this.elements.localVideo = document.getElementById('localVideo');
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'videoStopped', user: this.currentUser }));
        }
      };

      createOffer = async (targetUser) => {
        if (this.peerConnections.has(targetUser)) return;
        const pc = this.createPeerConnection(targetUser);
        this.peerConnections.set(targetUser, pc);
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.ws.send(JSON.stringify({ type: 'offer', from: this.currentUser, to: targetUser, offer }));
        } catch (err) {
          this.showStatus('Failed to create offer: ' + err.message);
          this.peerConnections.delete(targetUser);
        }
      };

      createPeerConnection = (targetUser) => {
        const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
        if (this.localStream) {
          this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream));
        }
        pc.ontrack = (e) => this.addRemoteVideo(targetUser, e.streams[0]);
        pc.onicecandidate = (e) =>
          e.candidate &&
          this.ws.send(JSON.stringify({ type: 'ice-candidate', from: this.currentUser, to: targetUser, candidate: e.candidate }));
        pc.onconnectionstatechange = () => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            this.handleUserLeft(targetUser);
          }
        };
        pc.onsignalingstatechange = () => {
          if (pc.signalingState === 'closed') this.handleUserLeft(targetUser);
        };
        return pc;
      };

      handleOffer = async (from, offer) => {
        if (this.peerConnections.has(from)) return;
        const pc = this.createPeerConnection(from);
        this.peerConnections.set(from, pc);
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.ws.send(JSON.stringify({ type: 'answer', from: this.currentUser, to: from, answer }));
        } catch (err) {
          this.showStatus('Failed to handle offer: ' + err.message);
          this.peerConnections.delete(from);
        }
      };

      handleAnswer = async (from, answer) => {
        const pc = this.peerConnections.get(from);
        if (pc && pc.signalingState !== 'stable') {
          try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
          } catch (err) {
            this.showStatus('Failed to handle answer: ' + err.message);
          }
        }
      };

      handleIceCandidate = async (from, candidate) => {
        const pc = this.peerConnections.get(from);
        if (pc) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            this.showStatus('Failed to add ICE candidate');
          }
        }
      };

      handleUserLeft = (user) => {
        const pc = this.peerConnections.get(user);
        if (pc) {
          pc.close();
          this.peerConnections.delete(user);
          const videoWrapper = document.getElementById(`video-wrapper-${user}`);
          if (videoWrapper) videoWrapper.remove();
        }
      };

      addRemoteVideo = (userId, stream) => {
        if (document.getElementById(`video-wrapper-${userId}`)) return;

        const videoWrapper = document.createElement('div');
        videoWrapper.id = `video-wrapper-${userId}`;
        videoWrapper.className = 'video-wrapper';

        const video = document.createElement('video');
        video.playsinline = true;
        video.muted = true;
        video.srcObject = stream;

        const controls = document.createElement('div');
        controls.className = 'video-controls';

        const muteButton = document.createElement('button');
        muteButton.textContent = 'Unmute';
        muteButton.className = 'btn btn-primary';

        const playButton = document.createElement('button');
        playButton.textContent = 'Play';
        playButton.className = 'btn btn-primary';

        const label = document.createElement('span');
        label.className = 'video-label';
        label.textContent = userId;

        controls.append(muteButton, playButton);
        videoWrapper.append(video, controls, label);
        this.elements.videoContainer.appendChild(videoWrapper);

        muteButton.addEventListener('click', () => {
          video.muted = !video.muted;
          muteButton.textContent = video.muted ? 'Unmute' : 'Mute';
        });

        playButton.addEventListener('click', async () => {
          try {
            if (video.paused) {
              await video.play();
              playButton.textContent = 'Stop';
            } else {
              video.pause();
              playButton.textContent = 'Play';
            }
          } catch (err) {
            this.showStatus(`Failed to control ${userId}'s video: ${err.message}`);
          }
        });

        video.play()
          .then(() => {
            playButton.textContent = 'Stop';
          })
          .catch((err) => {
            console.log(`Autoplay failed for ${userId}: ${err.message}`);
          });
      };

      cleanup = () => {
        this.stopVideo();
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ type: 'leave', user: this.currentUser }));
          this.ws.close();
        }
      };

      showStatus = (msg) => {
        this.elements.statusMessage.textContent = msg;
        setTimeout(() => (this.elements.statusMessage.textContent = ''), 5000);
      };

      scrollMessages = () => {
        this.elements.messages.scrollTop = this.elements.messages.scrollHeight;
      };
    }

    document.addEventListener('DOMContentLoaded', () => {
      try {
        new ChatApp();
      } catch (err) {
        console.error('Failed to initialize ChatApp:', err);
        document.getElementById('statusMessage').textContent = 'Failed to initialize chat application';
      }
    });