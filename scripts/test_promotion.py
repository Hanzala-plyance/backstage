import unittest
from check_promotion import check_report, REQUIRED

class PromotionTests(unittest.TestCase):
    def report(self):
        return {'runtime':'electron', 'tested_commit':'abc', 'artifact':'Backstage.app', 'reviewer':'Reviewer',
                'rollback':'Reinstall previous release',
                'specs_report':'https://github.com/Hanzala-plyance/backstage-specs/blob/meta/releases/0.1.md',
                'checks': {key:{'status':'passed','evidence':'Recorded check'} for key in REQUIRED}}
    def test_runtime_is_explicit(self):
        report=self.report(); report['runtime']='unknown'
        with self.assertRaises(ValueError): check_report('stage','develop',report)
    def test_main_rejects_shortcuts(self):
        for source in ('develop','feature/example','starter'):
            with self.assertRaises(ValueError): check_report('main',source,self.report())
    def test_stage_requires_real_build_evidence(self):
        report=self.report(); report['checks']['runtime_build']['status']='not-run'
        with self.assertRaises(ValueError): check_report('stage','develop',report)
    def test_main_requires_all_acceptance_results(self):
        for key in REQUIRED:
            report=self.report(); report['checks'][key]['evidence']=''
            with self.assertRaises(ValueError): check_report('main','stage',report)
    def test_valid_promotions_have_correct_route_and_evidence(self):
        check_report('stage','develop',self.report())
        check_report('main','stage',self.report())

if __name__ == '__main__': unittest.main()
