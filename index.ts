/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2025 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { ApplicationCommandInputType, ApplicationCommandOptionType, findOption, sendBotMessage } from "@api/Commands";
import { Logger } from "@utils/Logger";
import definePlugin from "@utils/types";
import { findStore } from "@webpack";
import { DraftType, UploadHandler, UserStore } from "@webpack/common";
import { User } from "discord-types/general";

const logger = new Logger("UserAffinities");

interface AffinitiesV2 {
    otherUserId: User["id"];
    userSegment: "NON_MAU" | "NON_HFU_MAU" | "HFU_MAU";
    otherUserSegment: "NON_MAU" | "NON_HFU_MAU" | "HFU_MAU";
    // 0.15
    isFriend: boolean;
    // 0.30
    dmProbability: number;
    dmRank: number;
    // 0.25
    vcProbability: number;
    vcRank: number;
    // 0.20
    serverMessageProbability: number;
    serverMessageRank: number;
    // 0.10
    communicationProbability: number;
    communicationRank: number;
}

interface Affinities {
    user_id: User["id"],
    affinity: number;
}

export default definePlugin({
    name: "affinities",
    description: "Adds a /affinities command to visualize user affinities",
    authors: [
        {
            name: "faf4a",
            id: 428188716641812481n
        }
    ],
    commands: [
        {
            inputType: ApplicationCommandInputType.BUILT_IN,
            name: "affinities",
            description: "Display user affinities as a visual word cloud",
            options: [
                {
                    name: "count",
                    description: "The amount of users to display",
                    type: ApplicationCommandOptionType.NUMBER
                },
                {
                    name: "algorithm",
                    description: "Use the old algorithm (v1) to calculate the affinity",
                    type: ApplicationCommandOptionType.BOOLEAN
                }
            ],
            execute: async (opts, cmdCtx) => {
                const count = findOption(opts, "count", 25);
                const useV1 = findOption(opts, "calculate", false);

                try {
                    const affinities: AffinitiesV2[] | Affinities[] = useV1 ? findStore("UserAffinitiesStore").getUserAffinities() : findStore("UserAffinitiesV2Store").getUserAffinities();

                    if (!affinities || affinities.length === 0) {
                        return sendBotMessage(cmdCtx.channel.id, { content: "You do not have any affinities, check your [privacy settings](<https://support.discord.com/hc/en-us/articles/21864805694999-Data-Used-to-Improve-Discord>)." });
                    }

                    let users = affinities.map(e => {
                        const user = UserStore.getUser(useV1 ? e.user_id : e.otherUserId);
                        const affinity = useV1 ? e.affinity : calculateAffinityScore(e);
                        return {
                            member: user,
                            affinity,
                        };
                    }).filter(x => x.member?.id);

                    if (users.length === 0) {
                        return sendBotMessage(cmdCtx.channel.id, { content: "You do not have any affinities, check your [privacy settings](<https://support.discord.com/hc/en-us/articles/21864805694999-Data-Used-to-Improve-Discord>)." });
                    }

                    users = users
                        .sort((a, b) => b.affinity - a.affinity)
                        .slice(0, count);

                    const minAffinity = Math.min(...users.map(u => u.affinity));
                    const maxAffinity = Math.max(...users.map(u => u.affinity));

                    const minSize = 80;
                    const maxSize = 160;

                    function getSize(affinity: number): number {
                        if (maxAffinity === minAffinity) return (minSize + maxSize) / 2;
                        return minSize + ((affinity - minAffinity) / (maxAffinity - minAffinity)) * (maxSize - minSize);
                    }

                    const avgSize = (minSize + maxSize) / 2;
                    logger.log(`${users.length}, ${users.map(x => x.member.username)}`);
                    const { width: canvasWidth, height: canvasHeight } = calculateCanvasSize(users.length, avgSize);

                    const canvas = document.createElement("canvas");
                    canvas.width = canvasWidth;
                    canvas.height = canvasHeight;
                    const ctx = canvas.getContext("2d")!;

                    const positions: Array<{ x: number, y: number, size: number; }> = [];
                    const userPositions = users.map(user => {
                        const size = getSize(user.affinity);
                        const pos = generatePoissonDiskPosition(positions, canvasWidth, canvasHeight, size);
                        positions.push({ x: pos.x, y: pos.y, size });
                        return {
                            ...user,
                            x: pos.x,
                            y: pos.y,
                            size: size
                        };
                    }).filter(x => x.member?.id);

                    let loadedImages = 0;
                    const totalImages = userPositions.length;

                    const drawImage = async (user: any) => {
                        try {
                            const avatarUrl = user.member?.avatar
                                ? `https://cdn.discordapp.com/avatars/${user.member?.id}/${user.member?.avatar}.webp?size=256`
                                : `https://cdn.discordapp.com/embed/avatars/${user.member?.id % 5}.png`;

                            const img = await loadImage(avatarUrl);

                            const centerX = user.x + user.size / 2;
                            const centerY = user.y + user.size / 2;

                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(centerX, centerY, user.size / 2, 0, Math.PI * 2);
                            ctx.clip();
                            ctx.drawImage(img, user.x, user.y, user.size, user.size);
                            ctx.restore();

                            const hue = (users.indexOf(user) / users.length) * 300;
                            ctx.strokeStyle = `hsl(${hue}, 80%, 60%)`;
                            ctx.lineWidth = 3;
                            ctx.beginPath();
                            ctx.arc(centerX, centerY, user.size / 2 + 1, 0, Math.PI * 2);
                            ctx.stroke();

                            loadedImages++;

                            if (loadedImages === totalImages) {
                                canvas.toBlob(blob => {
                                    if (!blob) return sendBotMessage(cmdCtx.channel.id, { content: "Couldn't generate the image :c" });
                                    const file = new File([blob], "affinities-cloud.png", { type: "image/png" });
                                    UploadHandler.promptToUpload([file], cmdCtx.channel, DraftType.ChannelMessage);
                                }, "image/png");
                            }
                        } catch (e: unknown) {
                            loadedImages++;

                            if (loadedImages === totalImages) {
                                canvas.toBlob(blob => {
                                    if (!blob) return sendBotMessage(cmdCtx.channel.id, { content: "Couldn't generate the image :c" });
                                    const file = new File([blob], "affinities-cloud.png", { type: "image/png" });
                                    UploadHandler.promptToUpload([file], cmdCtx.channel, DraftType.ChannelMessage);
                                }, "image/png");
                            } else {
                                if (e instanceof Error)
                                    return sendBotMessage(cmdCtx.channel.id, { content: e.message });
                                else logger.error(e);
                            }
                        }
                    };

                    userPositions.forEach(user => {
                        drawImage(user);
                    });

                } catch (e: unknown) {
                    if (e instanceof Error)
                        sendBotMessage(cmdCtx.channel.id, { content: e.message });
                    else logger.error(e);
                }
            },
        },
    ]
});

function calculateAffinityScore(affinity: AffinitiesV2): number {
    const weights = {
        friend: 0.15,
        dm: 0.30,
        vc: 0.25,
        serverMsg: 0.20,
        communication: 0.10
    };

    let score = 0;

    if (affinity.isFriend) score += weights.friend * 100;
    score += (affinity.dmProbability * weights.dm * 100);
    score += (affinity.vcProbability * weights.vc * 100);
    score += (affinity.serverMessageProbability * weights.serverMsg * 100);
    score += (affinity.communicationProbability * weights.communication * 100);

    score = Math.min(100, Math.max(0, score));
    return Math.round(score * 100) / 100;
}

// stolen from petpet, thanks vee
function loadImage(source: File | string): Promise<HTMLImageElement> {
    const isFile = source instanceof File;
    const url = isFile ? URL.createObjectURL(source) : source;

    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            if (isFile)
                URL.revokeObjectURL(url);
            resolve(img);
        };
        img.onerror = (event, _source, _lineno, _colno, err) => reject(err || event);
        img.crossOrigin = "anonymous";
        img.src = url;
    });
}

// stolen from random stackoverflow post that taught me how awful canvas ist
function generatePoissonDiskPosition(
    existingPositions: Array<{ x: number, y: number, size: number; }>,
    canvasWidth: number,
    canvasHeight: number,
    size: number
): { x: number, y: number; } {
    const edgePadding = 10;
    const minDist = size * 1.5;
    const textSpace = 60;
    const k = 30;

    function isValid(x: number, y: number) {
        if (
            x < edgePadding + size / 2 ||
            x > canvasWidth - edgePadding - size / 2 ||
            y < edgePadding + size / 2 ||
            y > canvasHeight - textSpace - edgePadding - size / 2
        ) return false;
        return !existingPositions.some(pos => {
            const dx = pos.x - x;
            const dy = pos.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const minAllowed = (pos.size + size) / 2 + (minDist - size);
            return dist < minAllowed;
        });
    }

    if (existingPositions.length === 0) {
        return {
            x: canvasWidth / 2 - size / 2,
            y: canvasHeight / 2 - size / 2
        };
    }

    for (let tries = 0; tries < 100; tries++) {
        const base = existingPositions[Math.floor(Math.random() * existingPositions.length)];
        for (let i = 0; i < k; i++) {
            const angle = Math.random() * 2 * Math.PI;
            const radius = minDist + Math.random() * minDist;
            const x = base.x + Math.cos(angle) * radius;
            const y = base.y + Math.sin(angle) * radius;
            if (isValid(x, y)) {
                return { x, y };
            }
        }
    }

    for (let tries = 0; tries < 100; tries++) {
        const x = Math.random() * (canvasWidth - size - edgePadding * 2) + edgePadding + size / 2;
        const y = Math.random() * (canvasHeight - size - textSpace - edgePadding * 2) + edgePadding + size / 2;
        if (isValid(x, y)) {
            return { x, y };
        }
    }

    return {
        x: edgePadding + size / 2,
        y: edgePadding + size / 2
    };
}

function calculateCanvasSize(userCount: number, avatarSize: number): { width: number, height: number; } {
    const padding = 50;
    const textSpace = 60;
    const itemWidth = avatarSize + padding;
    const itemHeight = avatarSize + textSpace + padding;

    const aspectRatio = 16 / 9;
    const cols = Math.ceil(Math.sqrt(userCount * aspectRatio));
    const rows = Math.ceil(userCount / cols);

    const width = Math.max(1000, cols * itemWidth + padding);
    const height = Math.max(700, rows * itemHeight + padding);

    return { width, height };
}
