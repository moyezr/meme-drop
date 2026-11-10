/** Authored synthetic Reddit-like DOM only; never fetches Reddit or stores live thread content. */
export function redditFixtureHtml(scenarioId, confirmation, options = {}) {
  const postId = `t3_${scenarioId.toString(36)}`;
  const kind = options.kind || "comment";
  const targetId = kind === "post" ? postId : "t1_selected";
  return `<!doctype html><html><head><style>
  body { margin:40px; font:16px system-ui; background:#fafafa; }
  shreddit-post, shreddit-comment, shreddit-composer { display:block; width:650px; padding:8px; }
  [contenteditable] { min-height:65px; border:1px solid #ccc; }
  [data-testid=media-preview] img { width:120px; height:120px; }
  button { min-height:32px; }
  comment-composer-host { display:contents; }
  </style></head><body><main>
  <shreddit-post id="${postId}" post-title="Our synthetic Friday launch" locked="false" archived="false" nsfw="false" ${kind === "post" ? 'data-fixture-target="true"' : ""}>
    <div slot="text-body">We skipped tests and deployed Friday.</div>
    <div class="actions"><button aria-label="Add a comment" ${kind === "post" ? 'id="native-reply"' : ""}>Comment</button></div>
  </shreddit-post>
  ${options.nativeStructure ? '<comment-body-header><textarea placeholder="Join the conversation" readonly></textarea></comment-body-header>' : ''}
  <section id="comments">
    <shreddit-comment thingid="t1_selected" postid="${postId}" ${kind === "comment" ? 'data-fixture-target="true"' : ""}>
      <div slot="comment">I warned them. Everything is on fire.</div>
      <div class="actions"><button aria-label="Reply" ${kind === "comment" ? 'id="native-reply"' : ""}>Reply</button></div>
      <shreddit-comment thingid="t1_child" postid="${postId}"><div slot="comment">Child text must never replace its parent.</div></shreddit-comment>
    </shreddit-comment>
    <shreddit-comment thingid="t1_other" postid="${postId}"><div slot="comment">Unrelated comment.</div></shreddit-comment>
  </section></main>
  <script>
  const options = ${JSON.stringify(options)};
  const targetId = ${JSON.stringify(targetId)};
  const confirmation = ${JSON.stringify(confirmation)};
  const target = document.querySelector('[data-fixture-target]');
  const nativeButton = document.querySelector('#native-reply');
  if (options.nativeStructure || options.nestedBodySlots) {
    const post=document.querySelector('shreddit-post');
    post.setAttribute('post-type','text');
    const body=post.querySelector('[slot="text-body"]');
    const host=document.createElement('shreddit-post-text-body');
    host.setAttribute('slot','text-body');body.replaceWith(host);host.append(body);
    host.attachShadow({mode:'open'}).innerHTML='<slot name="text-body"></slot><button>Read more</button>';
  }
  if (options.ambiguousBody) {
    document.querySelector('shreddit-post').setAttribute('post-type','text');
    const extra=document.createElement('div');extra.setAttribute('slot','text-body');
    extra.textContent='A different synthetic post body.';
    document.querySelector('shreddit-post').append(extra);
  }
  if (options.nativeStructure) {
    if (${JSON.stringify(kind)} === 'post') {
      nativeButton.removeAttribute('aria-label');
      nativeButton.setAttribute('name','comments-action-button');
    } else {
      nativeButton.removeAttribute('aria-label');
      const tracker=document.createElement('faceplate-tracker');
      tracker.setAttribute('slot','comment-reply');
      nativeButton.replaceWith(tracker);
      tracker.append(nativeButton);
    }
  }
  if (options.actionShadow) target.querySelector('.actions').attachShadow({mode:'open'}).append(nativeButton);
  if (options.missingContext) document.querySelector('shreddit-post').removeAttribute('post-title');
  if (options.wrongPost) target.setAttribute('postid','t3_another');
  if (options.nsfw) document.querySelector('shreddit-post').setAttribute('nsfw','true');
  if (options.missingBody) {
    document.querySelector('shreddit-post').setAttribute('post-type','text');
    document.querySelector('[slot="text-body"]').remove();
  }
  const other = document.querySelector('shreddit-comment[thingid="t1_other"]');
  window.__nativeReplyClicks = 0;
  window.__submitClicks = 0;
  window.__uploads = [];
  window.__nativeInputs = [];
  window.__rootOpenClicks = 0;
  function mountComposer(owner, id) {
    const scope = document.createElement('shreddit-composer');
    scope.setAttribute('parent-id', id);
    let outer=scope;
    if (options.nativeStructure) {
      outer=document.createElement('comment-composer-host');
      outer.setAttribute('post-id', ${JSON.stringify(postId)});
      if (id.startsWith('t1_')) outer.setAttribute('parent-id',id);
      scope.removeAttribute('parent-id');
      const form=document.createElement('faceplate-form');
      form.append(scope);outer.append(form);
    }
    const root = options.shadow || options.closedShadow ? scope.attachShadow({mode:options.closedShadow ? 'closed' : 'open'}) : scope;
    root.innerHTML = '<style>[contenteditable]{display:block;min-height:65px}button{min-height:32px}</style>' +
      '<div contenteditable="true" role="textbox">Existing synthetic draft</div>' +
      '<button aria-label="Add an image">Image</button><input type="file" accept="image/*" hidden>' +
      '<div data-testid="media-preview"></div><button class="submit">Comment</button>';
    let input = root.querySelector('input');
    let control = root.querySelector('[aria-label="Add an image"]');
    const editor=root.querySelector('[contenteditable]');
    if (options.nativeStructure) {
      editor.setAttribute('slot','rte');
      const rte=document.createElement('reddit-rte');
      scope.append(rte);
      const toolbar=rte.attachShadow({mode:'open'});
      const imageTool=document.createElement('rte-toolbar-button-image');
      const imageRoot=imageTool.attachShadow({mode:'open'});
      imageRoot.append(control,input);
      control.removeAttribute('aria-label');
      control.setAttribute('aria-disabled','false');
      const videoTool=document.createElement('rte-toolbar-button-video');
      const videoRoot=videoTool.attachShadow({mode:'open'});
      const video=document.createElement('input');video.type='file';video.accept='video/mp4';video.hidden=true;
      videoRoot.append(video);toolbar.append(imageTool,videoTool);
      // Mirrors a native toolbar exceeding the original 512-node UI query budget.
      for(let i=0;i<650;i++)scope.append(document.createElement('data'));
      window.__nativeInputs.push({id,image:input,video});
    }
    if (options.capability === 'absent') control.remove();
    if (options.capability === 'disabled') control.disabled = true;
    control.onclick = () => input.click();
    root.querySelector('.submit').onclick = () => window.__submitClicks++;
    input.onchange = async () => {
      if (!input.files.length) return;
      if (options.disableDuringUpload) control.disabled = true;
      const image = await createImageBitmap(input.files[0]);
      window.__uploads.push({target:id,width:image.width,height:image.height});
      image.close();
      if (confirmation === 'ignore') return;
      const preview = options.nativeStructure ? editor : root.querySelector('[data-testid="media-preview"]');
      preview.setAttribute('aria-busy', 'true');
      setTimeout(() => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(input.files[0]);
        if (options.nativeStructure) {
          const media=document.createElement('rte-image');
          media.setAttribute('media-id','synthetic-media');
          if(options.nativeImageMode !== 'missing-key')media.setAttribute('key','synthetic-key');
          img.setAttribute('data-media-id',options.nativeImageMode === 'mismatch' ? 'wrong-media' : 'synthetic-media');
          media.attachShadow({mode:'open'}).append(img);
          (options.nativeImageMode === 'outside-editor' ? scope : editor).append(media);
        } else preview.append(img);
        if (!options.nativeStructure && options.removable !== false) {
          const remove = document.createElement('button');
          remove.setAttribute('aria-label','Remove image');
          remove.onclick = () => preview.replaceChildren();
          preview.append(remove);
        }
        preview.removeAttribute('aria-busy');
        if (options.disableDuringUpload) control.disabled = false;
      }, 220);
    };
    if (options.duplicateInput) root.append(input.cloneNode());
    owner.append(outer);
    return outer;
  }
  window.__otherComposer = mountComposer(other,'t1_other');
  nativeButton.onclick = () => {
    window.__nativeReplyClicks++;
    if (options.nativeStructure && ${JSON.stringify(kind)} === 'post') return;
    if (window.__selectedComposer) {
      window.__selectedComposer.remove();
      window.__selectedComposer = null;
      return;
    }
    if (options.missingRoot) document.querySelector('shreddit-post').remove();
    if (!window.__selectedComposer) window.__selectedComposer = mountComposer(target,targetId);
    if (options.ambiguous) mountComposer(target,targetId);
  };
  if(options.nativeStructure) {
    document.querySelector('comment-body-header textarea').onfocus=()=>{
      window.__rootOpenClicks++;
      if(!window.__selectedComposer)window.__selectedComposer=mountComposer(document.querySelector('comment-body-header'),targetId);
    };
  }
  if(options.switchToComment) {
    const comment=document.querySelector('shreddit-comment[thingid="t1_selected"]');
    comment.querySelector('.actions button').onclick=()=>{
      window.__nativeReplyClicks++;
      window.__postComposer=window.__selectedComposer;
      setTimeout(()=>{window.__selectedComposer=mountComposer(comment,'t1_selected')},180);
    };
  }
  if (options.huge) {
    const fragment = document.createDocumentFragment();
    for (let i=0;i<2000;i++) {
      const sibling = document.createElement('shreddit-comment');
      sibling.setAttribute('thingid','t1_sibling' + i);
      sibling.innerHTML = '<div slot="comment">Unrelated synthetic branch</div>';
      // A whole-thread textContent read must fail this fixture.
      Object.defineProperty(sibling, 'textContent', {get(){throw Error('Whole-thread extraction')}});
      fragment.append(sibling);
    }
    target.append(fragment);
    let deep = document.createElement('div');
    document.querySelector('#comments').append(deep);
    for (let i=0;i<80;i++) { const next=document.createElement('div');deep.append(next);deep=next; }
    deep.append(target);
  }
  if (options.long) {
    document.querySelector('[slot="text-body"]').append(' x'.repeat(10000));
    target.querySelector('[slot="comment"]').append(' y'.repeat(10000));
  }
  </script></body></html>`;
}
