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

interface Affinities {
    user_id: User["id"];
    affinity: number;
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

function generateRandomPosition(existingPositions: Array<{ x: number, y: number, size: number; }>, canvasWidth: number, canvasHeight: number, size: number, attempts = 100): { x: number, y: number; } {
    const padding = 40;
    const textSpace = 50;

    for (let i = 0; i < attempts; i++) {
        const x = Math.random() * (canvasWidth - size - padding * 2) + padding;
        const y = Math.random() * (canvasHeight - size - textSpace - padding * 2) + padding;

        let collision = false;
        // thanks random stackoverflow user for this
        for (const pos of existingPositions) {
            const centerX1 = x + size / 2;
            const centerY1 = y + size / 2;
            const centerX2 = pos.x + pos.size / 2;
            const centerY2 = pos.y + pos.size / 2;

            const distance = Math.sqrt(Math.pow(centerX1 - centerX2, 2) + Math.pow(centerY1 - centerY2, 2));
            const minDistance = (size + pos.size) / 2 + padding;

            if (distance < minDistance) {
                collision = true;
                break;
            }
        }

        if (!collision) {
            return { x, y };
        }
    }

    const cols = Math.floor(canvasWidth / (size + padding));
    const rows = Math.floor(canvasHeight / (size + textSpace + padding));
    const totalSlots = cols * rows;

    if (existingPositions.length < totalSlots) {
        const index = existingPositions.length;
        const col = index % cols;
        const row = Math.floor(index / cols);

        return {
            x: col * (size + padding) + padding,
            y: row * (size + textSpace + padding) + padding
        };
    }

    return {
        x: Math.random() * (canvasWidth - size - padding * 2) + padding,
        y: Math.random() * (canvasHeight - size - textSpace - padding * 2) + padding
    };
}

function calculateCanvasSize(userCount: number, avatarSize: number): { width: number, height: number; } {
    const padding = 40;
    const textSpace = 50;
    const itemWidth = avatarSize + padding;
    const itemHeight = avatarSize + textSpace + padding;

    const cols = Math.ceil(Math.sqrt(userCount * 1.5));
    const rows = Math.ceil(userCount / cols);

    const width = Math.max(800, cols * itemWidth + padding);
    const height = Math.max(600, rows * itemHeight + padding);

    return { width, height };
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
    required: true,
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
                }
            ],
            execute: async (opts, cmdCtx) => {
                const count = findOption(opts, "count", 25);

                try {
                    const affinities: Affinities[] = findStore("UserAffinitiesStore").getUserAffinities();

                    if (!affinities || affinities.length === 0) {
                        return sendBotMessage(cmdCtx.channel.id, { content: "You do not have any affinities, check your privacy settings" });
                    }

                    let users = affinities.map(e => {
                        const user = UserStore.getUser(e.user_id);
                        return {
                            member: user,
                            affinity: e.affinity,
                        };
                    }).filter(Boolean);

                    if (users.length === 0) {
                        return sendBotMessage(cmdCtx.channel.id, { content: "You do not have any affinities, check your privacy settings" });
                    }

                    users = users
                        .sort((a, b) => b.affinity - a.affinity)
                        .slice(0, count);

                    const totalAffinity = users.reduce((sum, user) => sum + user.affinity, 0);

                    const affs = users.map(u => u.affinity);
                    const minAffinity = Math.min(...affs);
                    const maxAffinity = Math.max(...affs);
                    const minSize = 100;
                    const maxSize = 180;

                    function getSize(affinity: number): number {
                        if (maxAffinity === minAffinity) return (minSize + maxSize) / 2;
                        return minSize + ((affinity - minAffinity) / (maxAffinity - minAffinity)) * (maxSize - minSize);
                    }

                    const avgSize = (minSize + maxSize) / 2;
                    const { width: canvasWidth, height: canvasHeight } = calculateCanvasSize(users.length, avgSize);

                    const canvas = document.createElement("canvas");
                    canvas.width = canvasWidth;
                    canvas.height = canvasHeight;
                    const ctx = canvas.getContext("2d")!;

                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    const positions: Array<{ x: number, y: number, size: number; }> = [];
                    const userPositions = users.map(user => {
                        const size = getSize(user.affinity);
                        const pos = generateRandomPosition(positions, canvasWidth, canvasHeight, size);
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

                            ctx.save();
                            ctx.beginPath();
                            ctx.arc(user.x + user.size / 2, user.y + user.size / 2, user.size / 2, 0, Math.PI * 2);
                            ctx.clip();
                            ctx.drawImage(img, user.x, user.y, user.size, user.size);
                            ctx.restore();

                            const hue = (users.indexOf(user) / users.length) * 240;
                            ctx.strokeStyle = `hsl(${240 - hue}, 70%, 60%)`;
                            ctx.lineWidth = 4;
                            ctx.beginPath();
                            ctx.arc(user.x + user.size / 2, user.y + user.size / 2, user.size / 2, 0, Math.PI * 2);
                            ctx.stroke();

                            const username = user.member.username.length > 15 ? user.member.username.substring(0, 15) + "..." : user.member.username;
                            const percentage = ((user.affinity / totalAffinity) * 100).toFixed(1);

                            const textX = user.x + user.size / 2;
                            const textY = user.y + user.size + 25;

                            ctx.font = "bold 14px Arial";
                            ctx.textAlign = "center";

                            ctx.fillStyle = "#ffffff";
                            ctx.fillText(username, textX, textY);

                            ctx.font = "16px Arial";
                            const percentY = textY + 18;

                            ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
                            ctx.fillText(`${percentage}%`, textX + 1, percentY + 1);

                            ctx.fillStyle = `hsl(${240 - hue}, 70%, 80%)`;
                            ctx.fillText(`${percentage}%`, textX, percentY);

                            loadedImages++;

                            if (loadedImages === totalImages) {
                                ctx.fillStyle = "#7289da";

                                canvas.toBlob(blob => {
                                    if (!blob) return;
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
