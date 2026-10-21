"""Synthetic negative controls for v5 failure readback; no narrative acceptance."""
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from test_benchmark_native import CATALOG, fixture, load_native, replay_records, seal_events


def failure_records(directory):
    records = replay_records()[:-1]
    f = records[0][2]['fixture']
    raw = json.dumps(f, ensure_ascii=False).encode()
    (directory/'fixture.json').write_bytes(raw)
    records[0][2].update(evidence_version=5, fixture_sha256=hashlib.sha256(raw).hexdigest())
    for index,title in [(1,'Initial title'),(5,'Committed title')]:
        view=records[index][2]['public_view']
        view.update(title=title,id='story',branch_id='main',active_branch_id='main',branches=[{'id':'main','name':'Main','revision':index//4+1}],reader={'information':[]},information=[])
        for page in view['pages']:
            page['reader']={'information':[]}
    before_view=copy.deepcopy(records[5][2]['public_view'])
    states=[records[1][2]['snapshot'],records[5][2]['snapshot']]
    titles=['Initial title','Committed title']
    stored=[{'revision':i+1,'page':copy.deepcopy(page),'state':copy.deepcopy(states[i]),'title':titles[i]} for i,page in enumerate(before_view['pages'])]
    def authority(view,pages):
        return {'scope':{'account_id':'synthetic','experience_id':'story','branch_id':'main'},'public_view':copy.deepcopy(view),'snapshots':[{'revision':p['revision'],'state':copy.deepcopy(p['state'])} for p in pages],'branches':[{'id':'main','name':'Main','title':pages[-1]['title'],'revision':len(pages),'parent_branch_id':None,'parent_revision':None,'state':copy.deepcopy(pages[-1]['state']),'pages':copy.deepcopy(pages)}],'preferences':[]}
    # v5 records a fresh baseline before every operation, including successful ones.
    records[2][2].update(authority_before=authority(records[1][2]['public_view'],stored[:1]),authority_method='fresh_service_new_connection_v1')
    records[2][2]['request'].update(branch_id='main',request_id='benchmark-S01')
    baseline=authority(before_view,stored)
    req={'request_id':'benchmark-S04','branch_id':'main','expected_revision':2,'mode':'act','input':f['steps'][3]['input']}
    operation={'request_id':'benchmark-S04','experience_id':'story','branch_id':'main','base_revision':2,'status':'failed'}
    records += [('operation_request','S04',{'step':f['steps'][3],'request':req,'before':copy.deepcopy(states[-1]),'authority_before':baseline,'authority_method':'fresh_service_new_connection_v1'}),
                ('operation_failure','S04',{'error':'synthetic generation failure','operation':operation,'lookup_error':'','model_calls':0,'elapsed_ms':1}),
                ('failure_readback','S04',{'request_event_seq':7,'failure_event_seq':8,'request':copy.deepcopy(req),'operation':copy.deepcopy(operation),'operation_lookup_error':'','authority_after':copy.deepcopy(baseline),'method':'fresh_service_new_connection_v1','readback_error':'','read_only_verified':True}),
                ('run_end','S04',{'status':'FAIL'})]
    return records


class FailureEvidenceTests(unittest.TestCase):
    def test_v5_failure_requires_independent_complete_bound_readback(self):
        module=load_native(self)
        for mutation in ['valid','missing','old_page','private_snapshot','old_title','branch_state','preferences','request_seq','failure_seq','scope','cached_method','false_claim','missing_before']:
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as temp:
                d=Path(temp);records=failure_records(d);audit=records[-2][2];after=audit['authority_after']
                if mutation=='missing': records.pop(-2)
                elif mutation=='old_page':after['branches'][0]['pages'][0]['page']['text']='rewrite old formal text'
                elif mutation=='private_snapshot':after['branches'][0]['pages'][0]['state']['facts'][0]['text']='changed old fact'
                elif mutation=='old_title':after['branches'][0]['pages'][0]['title']='other title'
                elif mutation=='branch_state':after['branches'][0]['state']['story_time']='tomorrow'
                elif mutation=='preferences':after['preferences']=[{'dimension':'voice','value':'new permanent preference'}]
                elif mutation=='request_seq':audit['request_event_seq']=3
                elif mutation=='failure_seq':audit['failure_event_seq']=6
                elif mutation=='scope':after['scope']['account_id']='other account'
                elif mutation=='cached_method':audit['method']='cached_previous_view'
                elif mutation=='false_claim':audit['readback_error']='database unavailable'
                elif mutation=='missing_before':del records[-4][2]['authority_before']
                seal_events(d,records)
                if mutation in ['valid','missing']:
                    result=module.verify_native(d,CATALOG)
                    self.assertEqual('FAIL',result['status'])
                    self.assertEqual('VERIFIED' if mutation=='valid' else 'INCOMPLETE',result['integrity'])
                    self.assertEqual(1 if mutation=='valid' else 0,result['independent_checks']['failure_no_writes']['verified'])
                else:
                    with self.assertRaises(ValueError):module.verify_native(d,CATALOG)

    def test_honest_failed_readback_retains_failure_without_inventing_no_writes(self):
        module=load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp);records=failure_records(d)
            records[-2][2].update(authority_after={},readback_error='database unavailable',read_only_verified=False)
            seal_events(d,records);result=module.verify_native(d,CATALOG)
            self.assertEqual('FAIL',result['status'])
            self.assertEqual(0,result['independent_checks']['failure_no_writes']['verified'])
            self.assertEqual(1,result['independent_checks']['failure_no_writes']['failed'])

    def test_legacy_failure_is_explicitly_not_independent_readback(self):
        module=load_native(self)
        with tempfile.TemporaryDirectory() as temp:
            d=Path(temp);records=failure_records(d)
            records[0][2]['evidence_version']=4;records.pop(-2)
            seal_events(d,records);result=module.verify_native(d,CATALOG)
            self.assertEqual('VERIFIED',result['integrity'])
            self.assertEqual('FAIL',result['status'])
            self.assertEqual(['S04'],result['independent_checks']['failure_no_writes']['legacy_unverified_steps'])

if __name__=='__main__':unittest.main()
