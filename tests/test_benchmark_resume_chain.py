"""Source-bound editorial and nested resume provenance, never quality acceptance."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from test_benchmark_editorial import editorial_records
from test_benchmark_native import CATALOG, load_native, seal_events


def cold_editorial_records(directory):
    old=editorial_records();f=old[0][2]['fixture'];initial=copy.deepcopy(old[1][2]['public_view'])
    initial.update(title='Initial title',reader={'information':[]},information=[])
    initial['pages'][0]['reader']={'information':[]}
    page={'revision':2,'mode':'act','input':f['steps'][0]['input'],'text':'Original committed paragraph.','reader':{'information':[]}}
    view=copy.deepcopy(initial);view.update(revision=2,title='Committed title',pages=initial['pages']+[page])
    raw=json.dumps(f,ensure_ascii=False).encode();(directory/'fixture.json').write_bytes(raw)
    records=[('manifest','',{'fixture':f,'fixture_sha256':hashlib.sha256(raw).hexdigest(),'evidence_version':4}),
             ('initial_readback','',{'snapshot':f['state'],'public_view':initial}),
             ('operation_request','S01',{'request':{'mode':'act','input':page['input'],'expected_revision':1},'before':f['state']}),
             ('model_request','S01',{'call':1,'request':{}}),('model_result','S01',{'call':1,'result':{},'error':''}),
             ('operation_committed','S01',{'snapshot':f['state'],'public_view':view,'model_calls':1})]
    req=copy.deepcopy(old[2][2]);req.update(before=f['state'],public_view=view,original_page=page);req['request']['expected_revision']=2
    result=copy.deepcopy(old[5][2]);result.update(snapshot=f['state'],public_view=view,original_page=page);result['result']['base_revision']=2
    records += [('editorial_request','S06',req),('model_request','S06',{'call':2,'request':{'messages':[{'role':'user','content':json.dumps({'original':page['text'],'request':req['request']['request']})}]}}),('model_result','S06',{'call':2,'result':{'text':json.dumps({'text':result['result']['text']})},'error':''}),('editorial_result','S06',result),('run_end','S06',{'status':'REVIEW'})]
    seal_events(directory,records)
    pages=[{'step':'','page':initial['pages'][0],'state':f['state'],'title':'Initial title','title_provenance':'source_public_view_title'},
           {'step':'S01','page':page,'state':f['state'],'title':'Committed title','title_provenance':'source_public_view_title'}]
    editorial={'step':'S06','source_root':(directory/'root.sha256').read_text().strip(),'source_request_event_seq':7,'source_result_event_seq':10,'request_data':req,'result_data':result}
    return records,pages,editorial


def resume_from(parent,destination,pages,editorial):
    for path in parent.iterdir():
        if path.name.endswith(('events.jsonl','root.sha256','fixture.json')):
            (destination/('source-'+path.name)).write_bytes(path.read_bytes())
    (destination/'fixture.json').write_bytes((parent/'fixture.json').read_bytes())
    f=json.loads((destination/'fixture.json').read_bytes())
    initial=copy.deepcopy(pages[0]['page']);latest=copy.deepcopy(pages[-1]['page'])
    view={'id':'story','branch_id':'main','revision':len(pages),'pages':[copy.deepcopy(p['page']) for p in pages],'title':pages[-1]['title'],'reader':latest['reader'],'information':latest['reader']['information']}
    manifest={'source_root':(parent/'root.sha256').read_text().strip(),'events_sha256':hashlib.sha256((parent/'events.jsonl').read_bytes()).hexdigest(),'pages':copy.deepcopy(pages),'editorials':[copy.deepcopy(editorial)]}
    records=[('manifest','',{'fixture':f,'fixture_sha256':hashlib.sha256((destination/'fixture.json').read_bytes()).hexdigest(),'evidence_version':5}),
             ('resume_manifest','',manifest),
             ('resume_readback','',{'public_view':view,'snapshots':[{'revision':p['page']['revision'],'state':p['state']} for p in pages],'stored_pages':[p['page'] for p in pages],'projection_migration':'information_recorded_revision_v1','stored_titles':[{'revision':p['page']['revision'],'title':p['title']} for p in pages],'title_binding':'source_public_view_title_v1','branch_title':pages[-1]['title']}),
             ('initial_readback','',{'snapshot':pages[0]['state'],'public_view':{'revision':1,'pages':[initial],'title':pages[0]['title'],'reader':initial['reader'],'information':initial['reader']['information']}}),
             ('restored_step','S01',copy.deepcopy(pages[1])),('restored_editorial','S06',copy.deepcopy(editorial)),('run_end','S06',{'status':'REVIEW'})]
    seal_events(destination,records)
    return records


class ResumeChainTests(unittest.TestCase):
    def test_nested_unapplied_editorial_restores_exact_original_artifact_once(self):
        module=load_native(self)
        for mutation in ['valid','missing_ancestor','ancestor_bytes','root','request_seq','candidate','applied_source','source_model_text','source_model_input','rerun','inherited_root']:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as temp:
                dirs=[Path(temp)/x for x in ['cold','once','twice']]
                for d in dirs:d.mkdir()
                cold,pages,editorial=cold_editorial_records(dirs[0])
                once=resume_from(dirs[0],dirs[1],pages,editorial)
                records=resume_from(dirs[1],dirs[2],pages,editorial);d=dirs[2]
                if mutation=='missing_ancestor':(d/'source-source-events.jsonl').unlink()
                elif mutation=='ancestor_bytes':(d/'source-source-events.jsonl').write_bytes((d/'source-source-events.jsonl').read_bytes()+b'\n')
                elif mutation=='root':records[1][2]['source_root']='0'*64
                elif mutation=='request_seq':records[5][2]['source_request_event_seq']=3
                elif mutation=='candidate':records[5][2]['result_data']['result']['text']='A different candidate.'
                elif mutation=='applied_source':
                    cold[9][2]['applied']=True;seal_events(dirs[0],cold);editorial['source_root']=(dirs[0]/'root.sha256').read_text().strip();editorial['result_data']['applied']=True
                    once=resume_from(dirs[0],dirs[1],pages,editorial);records=resume_from(dirs[1],d,pages,editorial)
                elif mutation=='source_model_text':
                    cold[8][2]['result']['text']='{"text":"A different actual model reply."}'
                    seal_events(dirs[0],cold);editorial['source_root']=(dirs[0]/'root.sha256').read_text().strip()
                    once=resume_from(dirs[0],dirs[1],pages,editorial);records=resume_from(dirs[1],d,pages,editorial)
                elif mutation=='source_model_input':
                    cold[7][2]['request']['messages'][0]['content']='{"original":"A different original paragraph.","request":"Different input."}'
                    seal_events(dirs[0],cold);editorial['source_root']=(dirs[0]/'root.sha256').read_text().strip()
                    once=resume_from(dirs[0],dirs[1],pages,editorial);records=resume_from(dirs[1],d,pages,editorial)
                elif mutation=='rerun':records.insert(-1,('editorial_request','S06',copy.deepcopy(editorial['request_data'])))
                elif mutation=='inherited_root':records[1][2]['editorials'][0]['source_root']=records[1][2]['source_root'];records[5][2]['source_root']=records[1][2]['source_root']
                seal_events(d,records)
                if mutation=='valid':
                    result=module.verify_native(d,CATALOG)
                    self.assertEqual('VERIFIED',result['integrity']);self.assertEqual('RESTORED',result['steps']['S06']);self.assertEqual(0,result['model_calls'])
                    self.assertEqual('SOURCE_BOUND',result['resume_editorials'])
                    self.assertEqual('VERIFIED',result['resume_source']['resume_source']['integrity'])
                else:
                    with self.assertRaises((ValueError,FileNotFoundError)):module.verify_native(d,CATALOG)

if __name__=='__main__':unittest.main()
