import * as fs from "node:fs";
import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";

const config = new pulumi.Config();
const sshPublicKey = config.require("sshPublicKey");

// SSH key — registered from your local public key
const sshKey = new hcloud.SshKey("openclaw", {
	publicKey: sshPublicKey,
});

// Firewall — SSH inbound only; all outbound allowed
const firewall = new hcloud.Firewall("openclaw", {
	rules: [
		{
			direction: "in",
			protocol: "tcp",
			port: "22",
			sourceIps: ["0.0.0.0/0", "::/0"],
			description: "SSH",
		},
	],
});

// Persistent volume for /root/.openclaw (10 GB, pre-formatted)
const volume = new hcloud.Volume("openclaw", {
	size: 10,
	location: "hel1",
	format: "ext4",
});

// Server — CPX22, Ubuntu 24.04, hel1
const server = new hcloud.Server("openclaw", {
	serverType: "cpx22",
	image: "ubuntu-24.04",
	location: "hel1",
	sshKeys: [sshKey.id],
	firewallIds: [firewall.id.apply((id) => parseInt(id))],
	userData: fs.readFileSync("cloud-init.yaml", "utf-8"),
});

// Attach volume to server (mount manually post-provision — see deployment.md Step 3)
export const volumeAttachment = new hcloud.VolumeAttachment("openclaw", {
	serverId: server.id.apply((id) => parseInt(id)),
	volumeId: volume.id.apply((id) => parseInt(id)),
	automount: false,
});

export const serverIp = server.ipv4Address;
export const volumeLinuxDevice = volume.linuxDevice;
