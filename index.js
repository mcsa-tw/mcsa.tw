'use strict'
const core = require('@actions/core')
const github = require('@actions/github')

const ORHPAN_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

;(async function run () {
	try {
		if (github.context.eventName !== 'issues') {
			return
		}

		const token = core.getInput('token')
		const client = new github.GitHub(token)
		await onIssue(client, github.context.repo, github.context.payload)
	} catch (e) {
		console.error(e)
		core.setFailed(e.message)
	}
})()

async function onIssue (client, repo, { action, label, issue }) {
	if (issue.state !== 'open' || issue.title !== 'generate_contact') {
		return
	}
	const { title, body, number } = issue
	const { owner, repo: name } = repo
	const [firstLine, secondLine, ...restLines] = body.split('\n')
	let ghPagesExists = false
	let pagesSha = ORHPAN_SHA

	try {
		const resp = await client.git.getRef({
			...repo,
			ref: 'heads/main'
		})
		pagesSha = resp.data.object.sha
		ghPagesExists = true
	} catch (e) { }

	let members = JSON.parse(firstLine);
	let tmp;
	let blobTree = [];
	let result = [];
	let template = '';
	let m = [];
	let content = '';

	try {
		const { data: indexContent } = await client.repos.getContents({
			...repo,
			path: 'contact/template.html',
			ref: 'heads/main'
		})
		template = Buffer.from(indexContent.content, indexContent.encoding).toString()
	} catch(e) {
		console.log(e);
	}

	for (var i = 0; i < members.length; i++) {
		m = members[i];
		if(m.i != '' && m.n != '' && m.j != '' && m.l != '' && m.p != '' && m.m != '') {
			content = template
			.replace(/\{\{i\}\}/g,m.i)
			.replace(/\{\{n\}\}/g,m.n)
			.replace(/\{\{j\}\}/g,m.j)
			.replace(/\{\{l\}\}/g,m.l)
			.replace(/\{\{p\}\}/g,m.p.replace(/(\d{4})(\d{3})(\d{3})/, '$1-$2-$3'))
			.replace(/\{\{m\}\}/g,m.m)

			tmp = await client.git.createBlob({
				...repo,
				content: Buffer.from(content).toString('base64'),
				encoding: 'base64'
			})
			await blobTree.push({
				sha: tmp.data.sha,
				path: `contact/${m.i}.html`,
				mode: '100644',
				type: 'blob'
			});
			await result.push(m);
		}
	}

	const { data: tree } = await client.git.createTree({
		...repo,
		tree: blobTree,
		base_tree: pagesSha
	})

	const { data: commit } = await client.git.createCommit({
		...repo,
		message: `Generator contact file${restLines.length ? ` \n\n${restLines.join('\n')}` : ''}`,
		tree: tree.sha,
		parents: pagesSha === ORHPAN_SHA ? [] : [pagesSha]
	})

	if (!ghPagesExists) {
		await client.git.createRef({
			...repo,
			ref: 'refs/heads/main',
			sha: commit.sha
		})
	} else {
		await client.git.updateRef({
			...repo,
			force: true,
			ref: 'heads/main',
			sha: commit.sha
		})
	}

	var commentContent = '### 已建立 '+ result.length +' 個頁面。\n| 職稱 | 姓名 | 網址 |\n| :---: | :---: | :--- |';
	for (var i = 0; i < result.length; i++) {
		commentContent += `\n| ${result[i].j} | ${result[i].n} | https://mcsa.tw/contact/${result[i].i} |`;
	}

	await client.issues.createComment({
		...repo,
		issue_number: number,
		body: commentContent
	})

	await client.issues.update({
		...repo,
		issue_number: number,
		state: 'closed'
	})
}
