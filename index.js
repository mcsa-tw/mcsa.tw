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
	const { title, body, number } = issue
	const { owner, repo: name } = repo
	if (issue.state !== 'open') { return }
	if (issue.title !== 'generate_contact') {
		return
	} else if (
		issue.author_association !== 'OWNER' &&
		issue.author_association !== 'MEMBER' &&
		issue.author_association !== 'COLLABORATOR' &&
		issue.author_association !== 'CONTRIBUTOR'
	) {
		console.log(issue.author_association);
		await client.reactions.createForIssue({
			...repo,
			issue_number: number,
			content: 'laugh'
		})
		await client.issues.update({
			...repo,
			issue_number: number,
			state: 'closed'
		})
		return
	} else {
		await client.reactions.createForIssue({
			...repo,
			issue_number: number,
			content: 'eyes'
		})
	}
	const [firstLine, secondLine, ...restLines] = body.split('\n')
	let ghPagesExists = false
	let pagesSha = ORHPAN_SHA

	try {
		const resp = await client.git.getRef({
			...repo,
			ref: 'heads/gh-pages'
		})
		pagesSha = resp.data.object.sha
		ghPagesExists = true
	} catch (e) { }

	let members = [];
	let tmp;
	let blobTree = [];
	let result = [];
	let template = '';
	let m = [];
	let content = '';

	try {
		members = JSON.parse(firstLine)
	} catch(e) {
		await client.issues.createComment({
			...repo,
			issue_number: number,
			body: '格式錯誤'
		})
		await client.reactions.createForIssue({
			...repo,
			issue_number: number,
			content: 'confused'
		})
		await client.issues.update({
			...repo,
			issue_number: number,
			state: 'closed'
		})
		return
	}

	try {
		const { data: indexContent } = await client.repos.getContents({
			...repo,
			path: 'contact/template.html',
			ref: 'heads/gh-pages'
		})
		template = Buffer.from(indexContent.content, indexContent.encoding).toString()
	} catch(e) {
		console.log(e);
	}

	for (var i = 0; i < members.length; i++) {
		m = members[i];
		if(m.i != '' && m.n != '' && m.j != '') {
			m.i = m.i.toUpperCase();
			content = template
			.replace(/\{\{i\}\}/g,m.i)
			.replace(/\{\{n\}\}/g,m.n)
			.replace(/\{\{j\}\}/g,m.j)
			.replace(/\{\{l\}\}/g,(m.l || ''))
			.replace(/\{\{p\}\}/g,(m.p || '').replace(/(\d{4})(\d{3})(\d{3})/, '$1-$2-$3'))
			.replace(/\{\{m\}\}/g,(m.m || ''))
			
			if(!m.l) content = content.replace('<a href="https://line.me/ti/p/"><i class="fab fa-line"></i> LINE</a><br/>','');
			if(!m.p) content = content.replace('<a href="tel:"><i class="fas fa-phone-alt"></i> </a><br/>','');
			if(!m.m) content = content.replace('<a href="mailto:"><i class="fas fa-envelope"></i> </a>','');

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

	if(blobTree.length == 0) {
		await client.issues.createComment({
			...repo,
			issue_number: number,
			body: '未找到任何聯絡資訊'
		})
		await client.reactions.createForIssue({
			...repo,
			issue_number: number,
			content: '-1'
		})
		await client.issues.update({
			...repo,
			issue_number: number,
			state: 'closed'
		})
		return
	}

	const { data: tree } = await client.git.createTree({
		...repo,
		tree: blobTree,
		base_tree: pagesSha
	})

	const { data: commit } = await client.git.createCommit({
		...repo,
		message: `Generate contact file${restLines.length ? ` \n\n${restLines.join('\n')}` : ''}`,
		tree: tree.sha,
		parents: pagesSha === ORHPAN_SHA ? [] : [pagesSha]
	})

	if (!ghPagesExists) {
		await client.git.createRef({
			...repo,
			ref: 'refs/heads/gh-pages',
			sha: commit.sha
		})
	} else {
		await client.git.updateRef({
			...repo,
			force: true,
			ref: 'heads/gh-pages',
			sha: commit.sha
		})
	}

	var commentContent = '### 已建立 '+ result.length +' 個頁面，請刪除此 Issue。\n| 職稱 | 姓名 | 網址 |\n| :---: | :---: | :--- |';
	for (var i = 0; i < result.length; i++) {
		commentContent += `\n| ${result[i].j} | ${result[i].n} | https://mcsa.tw/contact/${result[i].i} |`;
	}

	await client.reactions.createForIssue({
		...repo,
		issue_number: number,
		content: 'hooray'
	})

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
