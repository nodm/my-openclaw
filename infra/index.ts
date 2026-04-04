import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as hcloud from "@pulumi/hcloud";
import * as pulumi from "@pulumi/pulumi";
import * as command from "@pulumi/command";

const config = new pulumi.Config();
const sshPublicKey = config.require("sshPublicKey");
const tailscaleAuthKey = config.requireSecret("tailscaleAuthKey");

const sshPrivateKey = fs.readFileSync(
	path.join(os.homedir(), ".ssh", "id_ed25519"),
	"utf-8",
);

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

// Server — CPX22, Ubuntu 24.04, hel1
const server = new hcloud.Server("openclaw", {
	serverType: "cpx22",
	image: "ubuntu-24.04",
	location: "hel1",
	sshKeys: [sshKey.id],
	firewallIds: [firewall.id.apply((id) => parseInt(id))],
	userData: fs.readFileSync("cloud-init.yaml", "utf-8"),
});

const connection = {
	host: server.ipv4Address,
	user: "root",
	privateKey: sshPrivateKey,
};

// Wait for cloud-init to complete before any post-provisioning steps
const waitForInit = new command.remote.Command(
	"wait-for-init",
	{
		connection,
		create: "cloud-init status --wait",
	},
	{ dependsOn: server },
);

// Upload .env, openclaw.json, and workspace files from local machine
const repoRoot = path.resolve(__dirname, "..");
const sshOpts = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null";

const uploadFiles = new command.local.Command(
	"upload-files",
	{
		create: pulumi.interpolate`scp ${sshOpts} ${repoRoot}/.env root@${server.ipv4Address}:/root/.openclaw/.env && scp ${sshOpts} ${repoRoot}/openclaw.json root@${server.ipv4Address}:/root/.openclaw/openclaw.json && rsync -av --delete --exclude ".env" --exclude "sessions/" -e "ssh ${sshOpts}" ${repoRoot}/workspace/ root@${server.ipv4Address}:/root/.openclaw/workspace/ && rsync -av --delete --exclude ".env" --exclude "sessions/" -e "ssh ${sshOpts}" ${repoRoot}/workspace-honey/ root@${server.ipv4Address}:/root/.openclaw/workspace-honey/`,
	},
	{ dependsOn: waitForInit },
);

// Set permissions, authenticate Tailscale, install and start OpenClaw daemon
const setupServices = new command.remote.Command(
	"setup-services",
	{
		connection,
		create: pulumi.interpolate`chmod 600 /root/.openclaw/.env && tailscale up --authkey=${tailscaleAuthKey} --ssh --accept-dns && tailscale serve --bg 18789 && openclaw daemon install && openclaw daemon start`,
	},
	{ dependsOn: uploadFiles },
);

export const serverIp = server.ipv4Address;
